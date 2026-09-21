import {
  getAppCredentials,
  getAppmaxBaseUrls,
  getApplePayDomain,
  getExternalKey,
  getInstallCallbackUrl,
} from "./config";
import { getAppAccessToken } from "./auth";
import { appmaxApiRequest } from "./http";

/**
 * Fluxo de instalação do app — ver /guides/instalacao e /guides/callback-instalacao.
 *
 * 1. authorizeInstall(): POST /app/authorize → devolve um hash de uso único.
 *    Redirecionamos o merchant para a tela de autorização da Appmax com ele.
 * 2. A Appmax redireciona de volta para `url_callback` com `?token=<hash>`.
 * 3. generateMerchantClient(): troca esse hash pelas credenciais do merchant
 *    via POST /app/client/generate. É NESSA chamada que a Appmax dispara o
 *    health check contra a nossa URL de validação (/api/appmax/validate).
 */

export async function authorizeInstall(): Promise<{ hash: string; redirectUrl: string }> {
  const appToken = await getAppAccessToken();
  const { appUuid } = getAppCredentials();
  const { authorizeRedirectUrl } = getAppmaxBaseUrls();

  const domain = await getApplePayDomain();
  const result = await appmaxApiRequest<{ token: string }>("POST", "/app/authorize", {
    token: appToken,
    body: {
      app_id: appUuid, // App UUID aqui — não o Numerical ID (ver /guides/instalacao)
      external_key: getExternalKey(),
      url_callback: await getInstallCallbackUrl(),
      // Registra o domínio público deste app para o Apple Pay. A doc é
      // inconsistente sobre o nome do campo (`domain_name` num trecho,
      // `domain_names` no exemplo de curl), então mandamos os dois.
      domain_name: domain,
      domain_names: [domain],
    },
  });

  return {
    hash: result.token,
    redirectUrl: authorizeRedirectUrl(result.token),
  };
}

/**
 * Procura um campo na resposta em vários caminhos possíveis — a API já
 * respondeu ora achatada, ora aninhada em `data.client.*`.
 */
function firstOf(source: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    let cursor: unknown = source;
    for (const segment of path.split(".")) {
      if (cursor === null || typeof cursor !== "object") {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    if (typeof cursor === "string" && cursor.length > 0) return cursor;
  }
  return undefined;
}

export async function generateMerchantClient(
  hash: string
): Promise<{ clientId: string; clientSecret: string; externalId?: string }> {
  const appToken = await getAppAccessToken();

  const result = await appmaxApiRequest<{
    client: { client_id: string; client_secret: string };
  }>("POST", "/app/client/generate", {
    token: appToken,
    body: { token: hash },
  });

  // O `external_id` que vale é o que devolvemos no health check (disparado
  // dentro desta chamada) — é esse que a Appmax registra. O eco aqui é raro e
  // serve só como rede de segurança para o caso de o health check não ter
  // rodado; quem chama decide o que fazer com ele.
  const externalId = firstOf(result, [
    "data.client.external_id",
    "data.external_id",
    "client.external_id",
    "external_id",
  ]);

  return {
    clientId: result.client.client_id,
    clientSecret: result.client.client_secret,
    externalId,
  };
}
