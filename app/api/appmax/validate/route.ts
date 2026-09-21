import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAppmaxEnvironment } from "@/lib/appmax/config";
import { getExternalId, writeState } from "@/lib/appmax/state";

/**
 * URL de validação (health check) — ver /guides/implementar-url-validacao.
 *
 * A Appmax chama este endpoint, server-to-server, durante o processamento de
 * `POST /app/client/generate`. O contrato:
 *
 * - Só `app_id` é garantido no corpo; os demais campos são opcionais.
 * - A resposta precisa ser EXATAMENTE HTTP 200 com um `external_id` (UUID v4).
 *   `201`/`204` não valem — sem isso a instalação aborta e nenhuma credencial
 *   de merchant é emitida.
 *
 * A URL precisa estar publicamente acessível via HTTPS (não funciona atrás de
 * `localhost` — use um túnel em desenvolvimento) e cadastrada no painel do app
 * em "Consultar Aplicativo → Desenvolver".
 *
 * ⚠️ UUID NOVO A CADA REQUISIÇÃO. A doc é explícita ("Gere um UUID novo a cada
 * requisição do health check") porque a Appmax REJEITA valores repetidos:
 * quando o `external_id` enviado já existe na base dela, ele é descartado e
 * substituído pelo `client_id` da instalação. Reaproveitar o id salvo é o que
 * faz o valor guardado aqui não existir do lado da Appmax — e o sintoma só
 * aparece muito depois, como `404 {"message":"Merchant not found"}` em toda
 * tokenização.
 *
 * Como o valor se renova a cada chamada, chamar esta rota à mão depois de
 * instalado ROTACIONA o `external_id` e quebra a tokenização até reinstalar.
 *
 * Em runtime serverless sem banco compartilhado entre instâncias isso não se
 * sustenta: a instância que responde o health check não é necessariamente a
 * que serve o checkout — ali o banco precisa ser externo e persistente.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    console.error("[Appmax][install] health check rejeitado: JSON inválido");
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const appId = body?.app_id;
  if (appId === undefined || appId === null || appId === "") {
    console.error("[Appmax][install] health check rejeitado: sem app_id");
    return NextResponse.json({ error: "app_id is required" }, { status: 400 });
  }

  const externalId = randomUUID();
  const alias = `appstore-demo-nextjs (${getAppmaxEnvironment()})`;
  const externalKey =
    typeof body.external_key === "string" ? body.external_key : undefined;
  const clientId = typeof body.client_id === "string" ? body.client_id : undefined;
  const clientSecret =
    typeof body.client_secret === "string" ? body.client_secret : undefined;

  writeState({
    externalId,
    externalKey,
    alias,
    // A Appmax às vezes já manda as credenciais do merchant aqui; o fluxo
    // principal as recebe na resposta de /app/client/generate.
    ...(clientId && clientSecret
      ? { merchantClientId: clientId, merchantClientSecret: clientSecret }
      : {}),
  });

  // O valor devolvido aqui é o que a Appmax REGISTRA. Se a gravação não pegou,
  // responder 200 criaria a divergência que quebra a tokenização: a Appmax
  // guarda este id e nós não temos nenhum. Melhor abortar a instalação agora,
  // com mensagem clara, do que "concluir" e quebrar no primeiro pagamento.
  const persisted = getExternalId();
  if (persisted !== externalId) {
    console.error(
      `[Appmax][install] ABORTANDO: external_id "${externalId}" não foi persistido (banco ficou com "${persisted ?? "vazio"}").`
    );
    return NextResponse.json(
      {
        error:
          "external_id não pôde ser persistido (banco indisponível?). Instalação abortada de propósito — seria registrado do lado da Appmax um id que este app não teria.",
      },
      { status: 500 }
    );
  }

  console.log(`[Appmax][install] health check OK — external_id=${externalId}`);
  return NextResponse.json({ external_id: externalId, alias }, { status: 200 });
}
