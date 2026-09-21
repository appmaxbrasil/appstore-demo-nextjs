/**
 * Configuração central da integração: um único lugar que resolve sandbox ×
 * produção e valida o que é obrigatório em cada etapa.
 *
 * Referência: /guides/ambientes e /guides/autenticacao em docs.appmax.com.br.
 */

export type AppmaxEnvironment = "sandbox" | "production";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Lazy import: evita puxar `better-sqlite3` (binário nativo) em módulos que só
 * precisam das URLs ou do ambiente ativo.
 */
function dbCredentials() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getCredentials } = require("../db/credentials") as typeof import("../db/credentials");
  return getCredentials(getAppmaxEnvironment());
}

/**
 * Ambiente ativo. Precedência: banco (seletor do Header) > `APPMAX_ENV` >
 * `"sandbox"`. Fica em `settings` e não em `credentials` porque esta última é
 * por-ambiente — lê-la exigiria já saber o ambiente.
 */
export function getAppmaxEnvironment(): AppmaxEnvironment {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getActiveEnvironment } = require("../db/settings") as typeof import("../db/settings");
  const active = getActiveEnvironment();
  if (active) return active;

  const raw = (env("APPMAX_ENV") ?? "sandbox").toLowerCase();
  return raw === "production" ? "production" : "sandbox";
}

/**
 * Contrato de callbacks usado no `AppmaxScripts.init()`. As duas formas são
 * suportadas pelo SDK e estão documentadas em /guides/appmax-js.
 *
 * - `structured` (padrão): objeto de opções, com um callback por evento
 *   (`onTokenize` / `onIp`) e `onError` estruturado (`{ code, message, stage,
 *   status, details }`). É a forma recomendada para código novo.
 * - `legacy`: assinatura posicional, com o `onSuccess` polimórfico (objeto
 *   `{ ip }` na coleta, string crua na tokenização) e `onError` como string.
 *   Continua funcionando e não será removida.
 *
 * Trocar aqui é o que permite exercitar as duas formas contra o mesmo checkout
 * — útil para quem mantém uma integração antiga e quer comparar.
 */
export type AppmaxScriptApi = "legacy" | "structured";

export function getAppmaxScriptApi(): AppmaxScriptApi {
  return env("APPMAX_SCRIPT_API") === "legacy" ? "legacy" : "structured";
}

export function getAppmaxBaseUrls() {
  const isProd = getAppmaxEnvironment() === "production";
  return {
    authUrl: isProd
      ? "https://auth.appmax.com.br"
      : "https://auth.sandboxappmax.com.br",
    apiUrl: isProd
      ? "https://api.appmax.com.br"
      : "https://api.sandboxappmax.com.br",
    /**
     * O `appmax.min.js` é um arquivo diferente em cada ambiente: a URL da API
     * fica embutida no bundle em tempo de build, e não existe parâmetro para
     * apontar o script de um ambiente para o outro. Carregar o bundle de
     * sandbox com `APPMAX_ENV=production` tokeniza num ambiente e cobra no
     * outro — o token não é encontrado e o erro que chega é um `404` genérico.
     * Ver /guides/ambientes.
     */
    scriptUrl: isProd
      ? "https://scripts.appmax.com.br/appmax.min.js"
      : "https://scripts.sandboxappmax.com.br/appmax.min.js",
    // URL de autorização (redirect do merchant durante a instalação)
    authorizeRedirectUrl: (hash: string) =>
      isProd
        ? `https://admin.appmax.com.br/appstore/integration/${hash}`
        : `https://breakingcode.sandboxappmax.com.br/appstore/integration/${hash}`,
  };
}

/**
 * Credenciais do APLICATIVO — só o fluxo de instalação. Precedência: banco
 * (editado em /configuracao) > env var, para trocar de app sem redeploy.
 */
export function getAppCredentials() {
  const row = dbCredentials();
  const appUuid = row?.appUuid ?? env("APPMAX_APP_UUID");
  const clientId = row?.appClientId ?? env("APPMAX_APP_CLIENT_ID");
  const clientSecret = row?.appClientSecret ?? env("APPMAX_APP_CLIENT_SECRET");
  if (!appUuid || !clientId || !clientSecret) {
    throw new Error(
      "Credenciais do app da Appmax ausentes. Preencha em /configuracao ou defina APPMAX_APP_UUID/APPMAX_APP_CLIENT_ID/APPMAX_APP_CLIENT_SECRET (veja .env.example)."
    );
  }
  return {
    appUuid,
    appNumericalId: row?.appNumericalId ?? env("APPMAX_APP_NUMERICAL_ID"),
    clientId,
    clientSecret,
  };
}

/** Chave usada para identificar esta instalação (equivalente a um store_id/merchant_id seu). */
export function getExternalKey(): string {
  const row = dbCredentials();
  return row?.externalKey ?? env("APPMAX_EXTERNAL_KEY") ?? "appstore-demo-nextjs";
}

/**
 * URL pública onde este app está acessível AGORA, derivada do `Host` da
 * requisição em andamento.
 *
 * De propósito não é um valor fixo em `.env`: o projeto roda atrás de um túnel
 * cuja URL muda a cada reinício, e um `APP_BASE_URL` estático faria o
 * `url_callback` da instalação (e o domínio registrado para o Apple Pay)
 * apontarem para um host antigo. A env var fica só como fallback para o caso
 * de a requisição chegar sem `Host` utilizável.
 *
 * Usada para: a URL de validação no painel do app, o `url_callback` da
 * instalação e o `domain_names` do Apple Pay em /app/authorize.
 */
export async function getAppBaseUrl(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { headers } = require("next/headers") as typeof import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");

  if (host) {
    const proto =
      h.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`;
  }

  const fallback = env("APP_BASE_URL");
  if (fallback) return fallback.replace(/\/+$/, "");

  throw new Error(
    "Não foi possível determinar a URL pública deste app a partir da requisição (sem header Host), e APP_BASE_URL não está definida como fallback."
  );
}

export async function getValidateUrl(): Promise<string> {
  return `${await getAppBaseUrl()}/api/appmax/validate`;
}

export async function getInstallCallbackUrl(): Promise<string> {
  return `${await getAppBaseUrl()}/api/setup/callback`;
}

/**
 * Reduz o que o usuário digitou a um domínio puro: a Apple rejeita o registro
 * com `domainName must be a fully qualified domain name without scheme or
 * path`, então `https://loja.com.br/checkout` precisa virar `loja.com.br`.
 */
export function normalizeDomain(value: string): string {
  return value
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "") // esquema
    .split(/[/?#]/)[0] // caminho, query, fragment
    .replace(/\.+$/, "") // ponto final de FQDN absoluto
    .toLowerCase();
}

/**
 * Domínio registrado para o Apple Pay em `POST /app/authorize` (`domain_name`).
 *
 * Precedência: o valor salvo em /configuracao para o ambiente ativo > o host da
 * requisição atual.
 *
 * O campo existe porque os dois nem sempre coincidem: o domínio que a Apple
 * precisa validar é o da página onde a PaymentSheet abre, que pode ser
 * diferente de onde este app de instalação está rodando (um túnel de
 * desenvolvimento, por exemplo). E como o domínio fica congelado no momento da
 * instalação, registrar o host do túnel por engano faz a merchant session
 * passar a falhar assim que o túnel muda de URL.
 */
export async function getApplePayDomain(): Promise<string> {
  const saved = dbCredentials()?.applePayDomain;
  if (saved) return normalizeDomain(saved);
  return new URL(await getAppBaseUrl()).host;
}
