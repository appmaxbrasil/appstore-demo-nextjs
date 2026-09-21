import { getAppCredentials, getAppmaxEnvironment, type AppmaxEnvironment } from "./config";
import { getMerchantCredentials } from "./state";
import { appmaxAuthRequest } from "./http";

/**
 * Tokens OAuth2 (client_credentials) da Appmax — ver /guides/autenticacao.
 *
 * Existem DOIS pares de credenciais, com escopos diferentes:
 * - App:      só o fluxo de instalação (/app/authorize, /app/client/generate).
 * - Merchant: as rotas transacionais (/v1/customers, /v1/orders, /v1/payments/*).
 *
 * Os tokens expiram em 1h e não há refresh token, então cacheamos em memória e
 * renovamos pouco antes de expirar.
 *
 * O cache é POR AMBIENTE: sandbox e produção têm emissores diferentes, e o
 * ambiente ativo troca em runtime. Uma chave só serviria o token do ambiente
 * anterior por até 1h — um 401 intermitente que some sozinho quando o token
 * expira, quase impossível de reproduzir.
 */

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type CachedToken = { accessToken: string; expiresAt: number };

type TokenCacheByEnv = Partial<Record<AppmaxEnvironment, CachedToken>>;

const appTokenCache: TokenCacheByEnv = {};
const merchantTokenCache: TokenCacheByEnv = {};

const SAFETY_MARGIN_MS = 30_000;

async function requestToken(clientId: string, clientSecret: string): Promise<CachedToken> {
  const body = (await appmaxAuthRequest("/oauth2/token", {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  })) as TokenResponse;

  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000 - SAFETY_MARGIN_MS,
  };
}

export async function getAppAccessToken(): Promise<string> {
  const environment = getAppmaxEnvironment();
  const cached = appTokenCache[environment];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }
  const { clientId, clientSecret } = getAppCredentials();
  const fresh = await requestToken(clientId, clientSecret);
  appTokenCache[environment] = fresh;
  return fresh.accessToken;
}

export async function getMerchantAccessToken(): Promise<string> {
  const environment = getAppmaxEnvironment();
  const cached = merchantTokenCache[environment];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }
  const credentials = getMerchantCredentials();
  if (!credentials) {
    throw new Error(
      "Credenciais do merchant ainda não configuradas. Conclua o fluxo em /setup primeiro."
    );
  }
  const fresh = await requestToken(credentials.clientId, credentials.clientSecret);
  merchantTokenCache[environment] = fresh;
  return fresh.accessToken;
}

/**
 * Chamado pelo /setup depois de gerar novas credenciais de merchant, para não
 * servir um token velho. Limpa os dois ambientes: um token órfão do outro
 * ambiente não tem por que sobreviver a uma reinstalação.
 */
export function resetMerchantTokenCache() {
  delete merchantTokenCache.sandbox;
  delete merchantTokenCache.production;
}
