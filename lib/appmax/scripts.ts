/**
 * Contrato do `appmax.min.js` (AppmaxJS).
 *
 * Este é o único arquivo que você precisa entender do SDK para integrar: tipos
 * dos callbacks, seletores de DOM e nomes de campo. Nada aqui importa código de
 * servidor, então dá para copiar o arquivo inteiro para outro projeto.
 *
 * Referência: https://docs.appmax.com.br/guides/appmax-js
 */

/**
 * Retorno esperado pelo `onUpdate` — o SDK usa isso para montar a PaymentSheet
 * do Apple Pay (itens de linha + total).
 *
 * ⚠️ Valores em REAIS, como `number` — não centavos, não string. O SDK roda
 * `cart.total.toFixed(2)` em cima disso; outro formato estoura com
 * `cart.total.toFixed is not a function` dentro do próprio script, e chega ao
 * `onError` como o genérico "Error processing payment".
 */
export type AppmaxCheckoutData = {
  orderId: string;
  total: number;
  freight: number;
  discount: number;
  installments: number;
  products: { name: string; price: number; quantity: number }[];
};

/**
 * Objeto devolvido pelo callback `onAuthorize(appleToken)` — é o
 * `ApplePayPaymentToken` nativo do Safari, repassado como veio. Ver
 * /api-reference/payments/apple-pay ("Mapeamento do Apple Token para o payload").
 */
export type AppleToken = {
  paymentData: {
    version: string;
    data: string;
    signature: string;
    header: {
      publicKeyHash?: string;
      ephemeralPublicKey: string;
      transactionId: string;
    };
  };
  paymentMethod: {
    displayName: string;
    network: string;
    type: string;
  };
  transactionIdentifier: string;
};

/**
 * O que o `onSuccess` recebe. É POLIMÓRFICO:
 *
 *   coleta de IP  → objeto `{ ip }`
 *   tokenização   → o token
 *
 * O token chega como STRING crua, e esse formato é estável: alterar o
 * payload deste callback quebraria toda integração que discrimina com
 * `typeof data === "string"`, e como o script é servido por URL única, quebraria
 * todas de uma vez. `data.token` é `undefined` aqui.
 *
 * O caminho novo é `onTokenize`, que entrega `{ token }`. `readCardToken` /
 * `readIp` abaixo cobrem as duas formas, para o código funcionar em qualquer
 * bundle e em qualquer um dos dois contratos.
 */
export type AppmaxSuccessData = { ip: string } | { token: string } | string;

/**
 * Erro padronizado do `onError`. Só chega nesta forma quando o `init()` é
 * chamado com objeto de opções — na forma posicional o `onError` continua
 * recebendo a mensagem como string, e só em falha de tokenização.
 */
export type AppmaxError = {
  /** `FINGERPRINT_FAILED`, `IP_FETCH_FAILED`, `FORM_SETUP_FAILED`, `MISSING_EXTERNAL_ID`, `TOKENIZATION_FAILED` */
  code: string;
  message: string;
  /** `fingerprint`, `ip`, `setup`, `tokenize` */
  stage: string;
  /** Código HTTP, quando a falha veio da API. */
  status?: number;
  /** Corpo da resposta (objeto, se for JSON). É o que diferencia 404 de 422. */
  details?: unknown;
};

/**
 * Extrai o token de cartão de qualquer uma das formas que o SDK já entregou.
 * Devolve `null` quando o payload é outra coisa (a coleta de IP, por exemplo).
 */
export function readCardToken(data: unknown): string | null {
  if (typeof data === "string") return data;
  // Defensivo: cobre um payload futuro que venha embrulhado.
  if (data instanceof String) return data.valueOf();
  if (data && typeof data === "object" && "token" in data) {
    const token = (data as { token: unknown }).token;
    return typeof token === "string" ? token : null;
  }
  return null;
}

/** Extrai o IP do payload da coleta. `null` quando o payload é outra coisa. */
export function readIp(data: unknown): string | null {
  if (data && typeof data === "object" && "ip" in data) {
    const ip = (data as { ip: unknown }).ip;
    return typeof ip === "string" ? ip : null;
  }
  return null;
}

/**
 * Objeto de opções aceito pelo `init()` — a forma recomendada para código
 * novo, documentada em /guides/appmax-js.
 *
 * `onTokenize` e `onIp` SUBSTITUEM o `onSuccess` no respectivo evento — cada
 * evento chama exatamente um callback, nunca os dois.
 */
export type AppmaxInitOptions = {
  externalId?: string | null;
  onSuccess?: (data: AppmaxSuccessData) => void;
  onTokenize?: (data: { token: string }) => void;
  onIp?: (data: { ip: string }) => void;
  onError?: (err: AppmaxError | unknown) => void;
  onUpdate?: () => AppmaxCheckoutData;
  onAuthorize?: (appleToken: AppleToken) => void | Promise<void>;
};

/**
 * O `init()` aceita as duas formas — ver `AppmaxScriptApi` em
 * lib/appmax/config.ts para trocar entre elas neste projeto.
 */
export type AppmaxScripts = {
  init: ((options: AppmaxInitOptions) => void) &
    ((
      onSuccess: (data: AppmaxSuccessData) => void,
      onError: (err: unknown) => void,
      externalId?: string,
      onUpdate?: () => AppmaxCheckoutData,
      onAuthorize?: (appleToken: AppleToken) => void | Promise<void>
    ) => void);
};

declare global {
  interface Window {
    ApplePaySession?: { canMakePayments: () => boolean };
    AppmaxScripts?: AppmaxScripts;
  }
}

/**
 * Atributos que o SDK procura no DOM. Ele faz `querySelector` UMA vez, durante
 * o `init()`, e não observa mudanças — elemento que nascer depois nunca é
 * encontrado, em silêncio. Por isso tudo isto fica sempre montado e só
 * escondido via CSS.
 */
export const APPMAX_SELECTORS = {
  /** Form vazio cuja presença dispara a coleta de IP. Ver a nota abaixo. */
  customerForm: "data-appmax-customer",
  /** Form de cartão cujo submit o SDK intercepta para tokenizar. */
  checkoutForm: "data-appmax-checkout",
  /** Container onde o SDK injeta o botão nativo do Apple Pay. */
  applePayButton: "appmax-apple-pay-btn",
} as const;

/**
 * ⚠️ NÃO troque o form `data-appmax-customer` por um `<span class="appmax-ip">`.
 *
 * O SDK aceita os dois como gatilho da coleta de IP, mas o caminho do
 * `.appmax-ip` faz `return` antes de registrar o listener do form de cartão:
 *
 *   if (document.getElementsByClassName('appmax-ip').length) {
 *     ...; return void onSuccess({ ip })     // ← sai aqui
 *   }
 *   if (document.querySelector('form[data-appmax-customer]')) { ...; onSuccess({ ip }) }
 *   this.setupFormSubmission()               // ← só o segundo caminho chega aqui
 *
 * Com `.appmax-ip`, o submit do form de cartão não faz absolutamente nada — sem
 * erro no console. Para checkout com cartão, o gatilho tem que ser o form.
 * */

/**
 * Nomes dos campos do cartão. Os dois atributos aparecem por motivos
 * diferentes:
 *
 * - `name`: é o que o SDK REALMENTE lê, via `new FormData(form)`. Não são
 *   livres — têm que ser exatamente estes.
 * - `appmax-form-element`: é o que a documentação manda marcar. O SDK não lê
 *   (a string não existe em nenhum dos dois bundles), mas mantemos para ficar
 *   igual ao exemplo oficial.
 *
 * `FormData` lê a propriedade `value` do DOM, que o React mantém sincronizada —
 * então tanto faz o input ser controlado ou não controlado.
 */
export const CARD_FIELDS = {
  number: { element: "number", name: "card-number" },
  holderName: { element: "holder_name", name: "card-holder-name" },
  expirationMonth: { element: "expiration_month", name: "exp-month" },
  expirationYear: { element: "expiration_year", name: "exp-year" },
  cvv: { element: "cvv", name: "cvv" },
} as const;
