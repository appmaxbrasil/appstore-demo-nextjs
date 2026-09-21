import { NextRequest, NextResponse } from "next/server";
import {
  clearApplePayDomain,
  getAllCredentials,
  saveCredentials,
  type CredentialRow,
} from "@/lib/db/credentials";
import { normalizeDomain, type AppmaxEnvironment } from "@/lib/appmax/config";

function maskSecret(value: string | null): string | null {
  if (!value) return value;
  if (value.length <= 4) return "•".repeat(value.length);
  return `${"•".repeat(value.length - 4)}${value.slice(-4)}`;
}

/** Nunca devolve segredos crus pro browser — só os últimos 4 caracteres. */
function maskRow(row: CredentialRow) {
  return {
    ...row,
    appClientSecret: maskSecret(row.appClientSecret),
    merchantClientSecret: maskSecret(row.merchantClientSecret),
  };
}

export async function GET() {
  const rows = getAllCredentials();
  return NextResponse.json({ environments: rows.map(maskRow) });
}

type Body = Partial<
  Pick<
    CredentialRow,
    | "appUuid"
    | "appNumericalId"
    | "appClientId"
    | "appClientSecret"
    | "externalKey"
    | "externalId"
    | "applePayDomain"
    | "merchantClientId"
    | "merchantClientSecret"
  >
> & { environment: AppmaxEnvironment };

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.environment !== "sandbox" && body.environment !== "production") {
    return NextResponse.json(
      { error: "environment deve ser 'sandbox' ou 'production'" },
      { status: 400 }
    );
  }

  // Campos vazios ("") não sobrescrevem o que já existe — só string
  // presente é tratada como "quero mudar isso". Evita que reenviar o form
  // sem editar o campo secreto (que chega mascarado, ver GET acima) apague
  // o valor de verdade salvo no banco.
  const patch: Partial<Omit<CredentialRow, "environment" | "updatedAt">> = {};
  for (const key of [
    "appUuid",
    "appNumericalId",
    "appClientId",
    "appClientSecret",
    "externalKey",
    "externalId",
    "applePayDomain",
    "merchantClientId",
    "merchantClientSecret",
  ] as const) {
    const value = body[key];
    if (typeof value === "string" && value.trim().length > 0 && !value.includes("•")) {
      // O domínio é gravado já limpo (sem esquema nem caminho), que é o formato
      // que a Apple aceita — e é o que a tela mostra de volta.
      patch[key] = key === "applePayDomain" ? normalizeDomain(value) : value.trim();
    }
  }

  // Para o domínio do Apple Pay, vazio é um valor com significado ("volte a
  // detectar pelo host"), e não "não mexi neste campo" — diferente dos
  // segredos, que chegam mascarados e não podem ser apagados por engano.
  if (typeof body.applePayDomain === "string" && body.applePayDomain.trim() === "") {
    clearApplePayDomain(body.environment);
  }

  const saved = saveCredentials(body.environment, patch);
  if (!saved) {
    return NextResponse.json(
      {
        error:
          "Não foi possível abrir o banco local (.appmax/appmax.db) — filesystem provavelmente somente-leitura neste runtime. Use env vars em vez desta tela.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
