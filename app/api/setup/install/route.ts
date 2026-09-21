import { NextResponse } from "next/server";
import { authorizeInstall } from "@/lib/appmax/install";

/**
 * Passos 1 e 2 do fluxo de instalação (/guides/instalacao): pega um token do
 * APLICATIVO, chama POST /app/authorize e redireciona o navegador para a tela
 * de autorização da Appmax.
 *
 * Depois que você autorizar por lá, a Appmax redireciona de volta para
 * /api/setup/callback com `?token=<hash>`.
 */
export async function GET() {
  try {
    const { redirectUrl } = await authorizeInstall();
    console.log("[Appmax][install] redirecionando para a autorização:", redirectUrl);
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error("[Appmax][install] falha em authorizeInstall()", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return NextResponse.json(
      { error: "Falha ao iniciar a instalação", detail: message },
      { status: 500 }
    );
  }
}
