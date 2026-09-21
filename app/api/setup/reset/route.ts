import { NextResponse } from "next/server";
import { getAppmaxEnvironment } from "@/lib/appmax/config";
import { clearInstall } from "@/lib/appmax/state";

/**
 * Zera a instalação do ambiente ativo: descarta o `external_id` e as
 * credenciais do merchant, deixando o checkout bloqueado até a nova instalação
 * terminar — em vez de operar com meia instalação.
 *
 * POST (e não GET) de propósito: destrói estado, então não pode ser disparado
 * por prefetch de link nem por visita acidental à URL.
 */
export async function POST() {
  const environment = getAppmaxEnvironment();
  const cleared = clearInstall(environment);

  if (!cleared) {
    return NextResponse.json(
      {
        error:
          "Não foi possível abrir o banco local (.appmax/appmax.db) — filesystem provavelmente somente-leitura neste runtime.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    cleared: true,
    environment,
    message: `Instalação de ${environment} removida. Rode a instalação de novo pra gerar um external_id novo.`,
  });
}
