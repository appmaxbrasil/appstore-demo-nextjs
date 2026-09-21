"use client";

import { useEffect, useRef, useState } from "react";
import { readCardToken, readIp } from "@/lib/appmax/scripts";
import type { AppleToken, AppmaxCheckoutData } from "@/lib/appmax/scripts";
import type { AppmaxScriptApi } from "@/lib/appmax/config";

type Params = {
  /** URL do bundle do ambiente ativo. `null` enquanto a config não carregou. */
  scriptUrl: string | null;
  /** `external_id` da instalação. `null` bloqueia o init — ver ponto 1. */
  externalId: string | null;
  /** Só para o log de diagnóstico. */
  environment?: string;
  /**
   * Contrato de callbacks a usar no `init()` — ver AppmaxScriptApi em
   * lib/appmax/config.ts. O padrão é a forma de objeto (`structured`).
   */
  scriptApi?: AppmaxScriptApi;
  /** Token do cartão, já discriminado do IP (ver ponto 5). */
  onCardToken: (token: string) => void;
  onError: (err: unknown) => void;
  /** Monta a PaymentSheet do Apple Pay. */
  getCheckoutData: () => AppmaxCheckoutData;
  /** Apple Pay autorizado: precisa LANÇAR se o pagamento falhar. */
  onAuthorize: (appleToken: AppleToken) => Promise<void>;
};

/**
 * Carrega e inicializa o `appmax.min.js`, e devolve o IP que ele coleta.
 *
 * Todo o ciclo de vida do SDK fica aqui para que o resto da integração seja
 * React comum. Quatro regras explicam quase todo o arquivo:
 *
 * 1. **`external_id` é pré-requisito, não detalhe.** Toda rota interna do SDK
 *    manda ele no header `external-id`. Sem ele o `init()` lança
 *    "External ID is required for Apple Pay use."; com um id que a Appmax não
 *    conhece, a tokenização volta `404 {"message":"Merchant not found"}` — que
 *    chega ao integrador como o genérico "Failed to tokenize card.". Por isso:
 *    sem id, nem carregamos o script.
 *
 * 2. **`init()` roda UMA vez por carga de página.** Uma segunda chamada
 *    substitui o handler do form em vez de empilhar (então um submit continua
 *    gerando uma tokenização), mas refaz a coleta de IP e o fingerprint — e o
 *    `externalId` fica congelado no primeiro init, porque o SDK o captura ali e
 *    não o relê. Quando o id muda de verdade, o único caminho é recarregar.
 *
 * 3. **Os elementos do DOM precisam existir ANTES do init.** O SDK faz
 *    `querySelector` uma vez. Em React isso se resolve sozinho — filhos montam
 *    antes dos efeitos do pai rodarem — desde que os elementos sejam sempre
 *    renderizados e só escondidos via CSS.
 *
 * 4. **Os callbacks ficam num ref**, para o `init()` não depender da identidade
 *    deles e não re-executar a cada render.
 *
 * 5. **O payload de sucesso depende da forma de `init()`.** Na forma de objeto
 *    o token chega como `{ token }` no `onTokenize`; na posicional, como string
 *    crua no `onSuccess`. A discriminação passa por `readCardToken`/`readIp`,
 *    que cobrem as duas, em vez de um `typeof` solto.
 *
 * O IP chega pelo `onSuccess` durante o próprio `init()`, sem submit e sem
 * reload, desde que o form `data-appmax-customer` esteja no DOM — ver
 * AppmaxIpForm.
 */
export function useAppmaxScripts({
  scriptUrl,
  externalId,
  environment,
  scriptApi = "structured",
  onCardToken,
  onError,
  getCheckoutData,
  onAuthorize,
}: Params): { ip: string | null } {
  const [ip, setIp] = useState<string | null>(null);

  // Espelho dos callbacks: o init roda uma vez e fecharia sobre versões velhas
  // se lesse as props direto.
  const callbacks = useRef({ onCardToken, onError, getCheckoutData, onAuthorize });
  useEffect(() => {
    callbacks.current = { onCardToken, onError, getCheckoutData, onAuthorize };
  }, [onCardToken, onError, getCheckoutData, onAuthorize]);

  /** Com qual `external_id` o `init()` já rodou (ver regra 2). */
  const initializedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!scriptUrl || !externalId) return;

    if (initializedFor.current) {
      if (initializedFor.current !== externalId) {
        console.warn(
          `[Appmax] external_id mudou de "${initializedFor.current}" para "${externalId}" depois do init(). O SDK não suporta troca em runtime — recarregando a página.`
        );
        window.location.reload();
      }
      return;
    }

    let cancelled = false;

    function init() {
      if (cancelled || !window.AppmaxScripts || initializedFor.current) return;
      initializedFor.current = externalId;

      // Primeiro lugar para olhar quando a Appmax responde "Merchant not
      // found": compare este id com o que a instalação registrou.
      console.log(
        `[Appmax] init() (${scriptApi}) com external_id=${externalId}${
          environment ? ` (ambiente: ${environment})` : ""
        }`
      );

      if (scriptApi === "structured") {
        // Forma recomendada: um callback por evento, cada um com payload
        // próprio, e `onError` estruturado. Ver /guides/appmax-js.
        window.AppmaxScripts.init({
          externalId,
          onTokenize: ({ token }) => callbacks.current.onCardToken(token),
          onIp: ({ ip }) => setIp(ip),
          onError: (err) => callbacks.current.onError(err),
          onUpdate: () => callbacks.current.getCheckoutData(),
          onAuthorize: (appleToken) => callbacks.current.onAuthorize(appleToken),
        });
        return;
      }

      window.AppmaxScripts.init(
        (data) => {
          // Token do cartão ou coleta de IP, em qualquer um dos formatos que o
          // SDK já entregou. Ver AppmaxSuccessData em lib/appmax/scripts.ts.
          const token = readCardToken(data);
          if (token) {
            callbacks.current.onCardToken(token);
            return;
          }
          const ip = readIp(data);
          if (ip) setIp(ip);
        },
        (err) => callbacks.current.onError(err),
        externalId!,
        () => callbacks.current.getCheckoutData(),
        (appleToken) => callbacks.current.onAuthorize(appleToken)
      );
    }

    if (window.AppmaxScripts) {
      init();
      return;
    }

    // Reaproveita a tag se ela já existir (o StrictMode monta o efeito duas
    // vezes em desenvolvimento).
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${scriptUrl}"]`
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", init);
    if (!existing) {
      script.src = scriptUrl;
      script.async = true;
      script.addEventListener("error", () =>
        callbacks.current.onError(
          new Error(`Não foi possível carregar o appmax.min.js de ${scriptUrl}`)
        )
      );
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      script.removeEventListener("load", init);
    };
  }, [scriptUrl, externalId, environment, scriptApi]);

  return { ip };
}
