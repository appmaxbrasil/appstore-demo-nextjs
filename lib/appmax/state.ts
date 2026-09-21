import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAppmaxEnvironment, type AppmaxEnvironment } from "./config";
import {
  clearInstallCredentials,
  getCredentials,
  saveCredentials,
} from "../db/credentials";

/**
 * Estado local da instalação: o `external_id` gerado no health check e as
 * credenciais do MERCHANT obtidas em `POST /app/client/generate`.
 *
 * O destino primário é o SQLite (lib/db/credentials.ts), com uma linha por
 * ambiente. O `state.json` é só um espelho best-effort, para quando o banco não
 * pôde ser aberto (ex.: filesystem somente-leitura) — nunca fonte primária de
 * leitura.
 *
 * Nada disso é apropriado para produção real: ali isso vira uma tabela
 * vinculada ao merchant, com os devidos controles de acesso.
 */

export type AppmaxState = {
  externalId?: string;
  externalKey?: string;
  alias?: string;
  merchantClientId?: string;
  merchantClientSecret?: string;
  updatedAt?: string;
};

const STATE_DIR = path.join(process.cwd(), ".appmax");
const STATE_FILE = path.join(STATE_DIR, "state.json");

export function readState(): AppmaxState {
  try {
    if (!existsSync(STATE_FILE)) return {};
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as AppmaxState;
  } catch {
    return {};
  }
}

export function writeState(patch: Partial<AppmaxState>): AppmaxState {
  const next: AppmaxState = {
    ...readState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  // Vai o `patch` CRU, nunca o `next`. `next` é o merge com o state.json, e
  // mandar esse merge ao banco reinjetaria um `externalId` velho parado em
  // disco a cada gravação — inclusive nas que só queriam salvar credencial de
  // merchant. `saveCredentials` faz upsert parcial (campo ausente = mantém o
  // que está lá), então o patch basta.
  saveCredentials(getAppmaxEnvironment(), {
    externalId: patch.externalId ?? null,
    externalKey: patch.externalKey ?? null,
    merchantClientId: patch.merchantClientId ?? null,
    merchantClientSecret: patch.merchantClientSecret ?? null,
  });

  // Best-effort: falhar aqui não pode derrubar quem chamou — o health check
  // precisa responder 200 de qualquer forma, ou a instalação inteira aborta.
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), "utf-8");
  } catch (error) {
    console.warn("[appmax/state] não foi possível gravar .appmax/state.json", error);
  }
  return next;
}

/**
 * Credenciais do merchant. Precedência: banco (linha do ambiente ativo) > env
 * var > espelho em `state.json`.
 *
 * O banco vem primeiro de propósito: uma `APPMAX_MERCHANT_CLIENT_ID/SECRET`
 * velha esquecida no `.env` venceria silenciosamente as credenciais novas
 * geradas pelo `/setup`, e o checkout quebraria com `invalid_client` logo
 * depois de uma instalação bem-sucedida.
 */
export function getMerchantCredentials(): {
  clientId: string;
  clientSecret: string;
} | null {
  const row = getCredentials(getAppmaxEnvironment());
  const state = readState();
  const clientId =
    row?.merchantClientId ?? process.env.APPMAX_MERCHANT_CLIENT_ID ?? state.merchantClientId;
  const clientSecret =
    row?.merchantClientSecret ??
    process.env.APPMAX_MERCHANT_CLIENT_SECRET ??
    state.merchantClientSecret;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * `external_id` da loja — o identificador que a Appmax associa ao merchant na
 * instalação e que o `AppmaxScripts.init()` manda no header `external-id` de
 * toda chamada do SDK.
 *
 * Fonte ÚNICA: a linha do ambiente ativo no banco. Sem fallback de env var nem
 * de `state.json` — um `APPMAX_EXTERNAL_ID` esquecido no `.env` venceria o
 * valor salvo pela instalação, e o SDK passaria a mandar um id que a Appmax não
 * conhece: `404 {"message":"Merchant not found"}` em toda tokenização.
 *
 * Sem linha no banco isto devolve `null` e o checkout nem carrega o SDK — ver o
 * guard em app/components/useAppmaxScripts.ts.
 */
export function getExternalId(): string | null {
  return getCredentials(getAppmaxEnvironment())?.externalId ?? null;
}

/**
 * Apaga o que a instalação produziu no ambiente dado. Limpa também o espelho em
 * `state.json`, senão ele ressuscitaria valores velhos no próximo
 * `writeState()`.
 */
export function clearInstall(environment: AppmaxEnvironment): boolean {
  const cleared = clearInstallCredentials(environment);

  try {
    if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
  } catch (error) {
    console.warn("[appmax/state] não foi possível apagar .appmax/state.json", error);
  }

  return cleared;
}
