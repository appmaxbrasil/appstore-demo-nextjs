"use client";

/**
 * Gatilho da coleta de IP do Appmax JS.
 *
 * A Appmax exige o IP do comprador em `POST /v1/customers`, e quem coleta é o
 * SDK. O gatilho é puramente a PRESENÇA deste form no DOM durante o `init()`:
 * o SDK faz `querySelector('form[data-appmax-customer]')`, busca o IP e entrega
 * em `onSuccess({ ip })` — sem submit, sem reload, sem nenhum campo aqui
 * dentro.
 *
 * Depois disso ele anexa um `<input type="hidden" name="ip">` a este form. Isso
 * existe para um checkout clássico, em que o submit nativo levaria o IP ao
 * servidor; numa SPA não serve para nada — o valor já chegou pelo callback.
 * Como quem insere esse nó é o SDK, o form fica SEM filhos: assim o React nunca
 * disputa a árvore com ele.
 *
 * ⚠️ Não troque este form por `<span class="appmax-ip">`. O SDK aceita os dois
 * como gatilho de IP, mas o caminho do `.appmax-ip` retorna antes de registrar
 * o listener do form de cartão — a tokenização para de funcionar em silêncio.
 * Ver a nota em lib/appmax/scripts.ts.
 */
export default function AppmaxIpForm() {
  return <form data-appmax-customer hidden />;
}
