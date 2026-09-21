import { NextRequest, NextResponse } from "next/server";
import { generateMerchantClient } from "@/lib/appmax/install";
import { resetMerchantTokenCache } from "@/lib/appmax/auth";
import { getExternalId, writeState } from "@/lib/appmax/state";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlPage(body: string) {
  return new NextResponse(
    `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Instalação Appmax</title>
<style>
  body { font: 14px/1.5 -apple-system, sans-serif; max-width: 640px; margin: 64px auto; padding: 0 24px; color: #171717; }
  code, pre { font: 13px/1.4 ui-monospace, monospace; background: #f4f4f5; border-radius: 6px; }
  pre { padding: 12px 14px; overflow-x: auto; }
  a { color: inherit; }
  .warn { background: #fffbeb; border: 1px solid #fde68a; padding: 12px 14px; border-radius: 8px; }
  .err { background: #fef2f2; border: 1px solid #fecaca; padding: 12px 14px; border-radius: 8px; }
</style>
</head>
<body>${body}</body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

/**
 * Destino do `url_callback` enviado em /app/authorize — ver
 * /guides/callback-instalacao. A Appmax redireciona o navegador do merchant
 * para cá com `?token=<hash>` depois da autorização, e trocamos esse hash
 * pelas credenciais do merchant (o que também dispara o health check).
 *
 * As credenciais são renderizadas na própria resposta, e não num redirect com
 * querystring, onde o `client_secret` ficaria em logs e no histórico do
 * navegador.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return htmlPage(
      `<h1>Faltou o token</h1><p class="err">A Appmax não mandou <code>?token=</code> no callback. Confira se a <code>url_callback</code> usada em <code>/app/authorize</code> bate com esta URL, sem fragment (<code>#</code>).</p><p><a href="/setup">← voltar para /setup</a></p>`
    );
  }

  try {
    const { clientId, clientSecret, externalId } = await generateMerchantClient(token);
    resetMerchantTokenCache();

    // O health check roda DENTRO do /app/client/generate acima, então a esta
    // altura o banco já tem o external_id que devolvemos — e é ele que a
    // Appmax registrou. Nada aqui pode sobrescrever esse valor, senão o banco
    // fica com um id que a Appmax nunca viu e toda chamada do SDK volta 404
    // "Merchant not found". O eco do generate (raro) é só rede de segurança
    // para o caso de o health check não ter rodado.
    const externalIdLocal = getExternalId();
    if (externalId && externalIdLocal && externalId !== externalIdLocal) {
      console.warn(
        `[Appmax][install] DIVERGÊNCIA de external_id — devolvemos "${externalIdLocal}" no health check e é esse que fica salvo, mas /app/client/generate ecoou "${externalId}". Se a tokenização der 404 "Merchant not found", teste o id ecoado antes de abrir bug.`
      );
    }
    if (!externalIdLocal) {
      console.error(
        `[Appmax][install] o banco está SEM external_id depois do generate — o health check não rodou ou não persistiu.${
          externalId ? ` Usando o id ecoado pelo generate ("${externalId}") como último recurso.` : " E o generate não ecoou nenhum: o checkout vai bloquear até você reinstalar."
        }`
      );
    }

    // Best-effort: em runtimes com filesystem somente-leitura isso é ignorado
    // silenciosamente (ver lib/appmax/state.ts).
    writeState({
      merchantClientId: clientId,
      merchantClientSecret: clientSecret,
      // Só entra se o health check não deixou nada — nunca por cima dele.
      ...(!externalIdLocal && externalId ? { externalId } : {}),
    });

    return htmlPage(`
      <h1>Instalação concluída ✅</h1>
      <p>Copie estas credenciais do <strong>merchant</strong> para as env vars do seu
      deploy (<code>APPMAX_MERCHANT_CLIENT_ID</code> / <code>APPMAX_MERCHANT_CLIENT_SECRET</code>)
      e redeploy/reinicie o servidor — em runtimes serverless elas <strong>não</strong>
      ficam salvas automaticamente entre requisições.</p>
      <pre>APPMAX_MERCHANT_CLIENT_ID=${escapeHtml(clientId)}
APPMAX_MERCHANT_CLIENT_SECRET=${escapeHtml(clientSecret)}</pre>
      <p class="warn">Também tentamos salvar em <code>.appmax/state.json</code> —
      só terá efeito se este processo tiver filesystem gravável (dev local).</p>
      <p><a href="/setup">← voltar para /setup</a> · <a href="/">ir para o checkout</a></p>
    `);
  } catch (error) {
    console.error("[Appmax][install] falha em generateMerchantClient()", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return htmlPage(
      `<h1>Falha na instalação</h1><p class="err">${escapeHtml(message)}</p><p><a href="/setup">← voltar para /setup e tentar de novo</a></p>`
    );
  }
}
