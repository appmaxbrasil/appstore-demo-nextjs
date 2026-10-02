# Fluxo de Google Pay — passo a passo

> Mapeia o fluxo sobre os arquivos **deste repositório**. O passo a passo
> oficial está em
> [`/api-reference/payments/google-pay-appmax-js`](https://docs.appmax.com.br/api-reference/payments/google-pay-appmax-js)
> (navegador) e
> [`/api-reference/payments/google-pay`](https://docs.appmax.com.br/api-reference/payments/google-pay)
> (endpoint).

Mapa em uma tela:

```
Browser (app/page.tsx)         appmax.min.js            iframe Appmax + Google     /api/checkout/google-pay
 │                                  │                          │                          │
 │  AppmaxScripts.init({            │                          │                          │
 │    externalId, onIp, onError,    │                          │                          │
 │    onUpdate, onAuthorize }) ────>│                          │                          │
 │                                  │  insere iframe ANTES de   │                          │
 │                                  │  [data-appmax-google-pay] │                          │
 │                                  │  chama onUpdate() ───────>│  (total da folha)        │
 │                                  │                          │  isReadyToPay → botão    │
 │  clique no botão (dentro do iframe) ───────────────────────>│                          │
 │                                  │                          │  abre a folha do Google  │
 │                                  │                          │  comprador confirma      │
 │                                  │                          │  FOLHA FECHA             │
 │                                  │  postMessage AUTHORIZED <─│                          │
 │                                  │  chama onAuthorize(pmd)   │                          │
 │  onGooglePayAuthorize(pmd)       │  (não espera o retorno)   │                          │
 │──────────────────────────────────────────────────────────────────────────────────────>│
 │                                  │                          │  POST /v1/payments/       │
 │                                  │                          │  google-pay               │
 │  aprovado / recusado <───────────────────────────────────────────────────────────────────│
 │  (mensagem na NOSSA tela)        │  relê onUpdate()          │                          │
```

O desenho é o mesmo do Apple Pay ([`FLUXO-APPLE-PAY.md`](FLUXO-APPLE-PAY.md)),
com duas diferenças que mudam o código: a folha abre **dentro de um iframe da
Appmax**, e ela **já fechou** quando o `onAuthorize` roda.

## 0. Pré-requisito: nenhum além da instalação

Diferente do Apple Pay, não há domínio a registrar, `domain_name` na
instalação nem arquivo `.well-known`. O Google valida a origem de onde a folha
abre, e ela abre no iframe da Appmax, cujo domínio já está aprovado. Se o app
já foi instalado em [`/setup`](app/setup/page.tsx), o Google Pay já funciona.

Continua valendo o resto: página em **HTTPS** (use a URL do túnel) e
`external_id` da instalação no banco.

## 1. `AppmaxScripts.init(...)` — o mesmo das outras carteiras

Em [`app/components/useAppmaxScripts.ts`](app/components/useAppmaxScripts.ts).
Não existe `init` próprio do Google Pay: os mesmos `externalId`, `onUpdate` e
`onAuthorize` servem às duas carteiras, e o SDK escolhe qual exibir.

```ts
window.AppmaxScripts.init({
  externalId: effectiveExternalId,
  onIp: ({ ip }) => setIp(ip),
  onTokenize: ({ token }) => onCardToken(token),  // cartão
  onError,
  onUpdate: () => getCheckoutData(),              // Apple Pay e Google Pay
  onAuthorize: authorize,                         // Apple Pay e Google Pay (§4)
});
```

| Onde o comprador está | O que o SDK mostra |
|---|---|
| Safari com cartão na Apple Wallet | Apple Pay; o Google Pay e o wrapper ficam ocultos |
| Chrome, Firefox, Edge… com conta Google e cartão salvo | Google Pay |
| Navegador sem suporte à Google Pay API | nada; âncora e wrapper ocultos |

A loja não escolhe a carteira, e o SDK não avisa qual exibiu (ver
"Diagnóstico").

⚠️ O SDK só liga as carteiras se `onUpdate` **e** `onAuthorize` forem
funções. Um typo (`onAutorize`) desliga Apple Pay e Google Pay em silêncio,
sem erro. Os demais avisos do `init()` (exceção síncrona sem `externalId`,
uma chamada por carga de página) são os mesmos do
[`FLUXO-APPLE-PAY.md`](FLUXO-APPLE-PAY.md) §1.

## 2. A âncora precisa existir ANTES do `init()`, e precisa de altura

Em [`app/components/GooglePayButton.tsx`](app/components/GooglePayButton.tsx):

```tsx
<div data-appmax-google-pay-wrapper className={visible ? "" : "hidden"}>
  <div data-appmax-google-pay className="h-12" />
</div>
```

- `[data-appmax-google-pay]` é só uma **âncora**: o SDK insere o iframe
  imediatamente **antes** dela, copia a altura dela (mínimo 48 px) e a oculta.
  O conteúdo da âncora nunca aparece.
- O iframe nasce **dentro do wrapper**, então é o wrapper que controla a
  visibilidade. Esconder só a âncora não esconderia o botão.
- O SDK procura a âncora **uma vez**, no `init()` — mesma regra do container
  do Apple Pay. Por isso os dois ficam sempre montados, escondidos por classe,
  nunca por render condicional.

⚠️ Nada de `display: none` na âncora: a altura seria lida como 0 e o botão
sairia cortado. E use `<div>`, não `<button>` (o exemplo da doc usa
`<button>`): dentro de um `<form>`, um `<button>` sem `type` vira submit.

O nome da loja exibido na folha vem de `data-appmax-merchant-name`, no
`[data-appmax-checkout]` de
[`CreditCardForm.tsx`](app/components/CreditCardForm.tsx). Sem ele, o SDK usa
o `<title>` da página.

## 3. `onUpdate()` — só o `total` importa, em reais

É o mesmo `getCheckoutData` do Apple Pay, em [`app/page.tsx`](app/page.tsx).
O Google Pay ignora `products`, `freight`, `discount` e `installments`: lê só
o `total`, aplica `.toFixed(2)` e manda ao Google em `BRL`.

```ts
total: totalCents / 100,   // 5.00, nunca 500
```

⚠️ O `onUpdate` é lido **no carregamento do iframe e depois de cada
tentativa**, nunca no clique. Se o carrinho mudar entre o carregamento e o
clique (cupom, frete), a folha mostra o total antigo. Neste projeto o total é
fixo, então não acontece.

⚠️ O valor **cobrado** não vem daqui: o body de `POST /v1/payments/google-pay`
não tem campo de valor, e a cobrança é o total do pedido criado em
`POST /api/checkout`. Um `total` errado no `onUpdate` só faz o comprador ver um
valor diferente do que vai pagar.

## 4. `onAuthorize` — um callback, duas carteiras

O SDK entrega o Apple Token **ou** o `paymentMethodData` do Google no mesmo
`onAuthorize`, sem dizer qual. O hook separa os dois pelo formato do objeto,
com `isGooglePaymentData` de [`lib/appmax/scripts.ts`](lib/appmax/scripts.ts):

```ts
function authorize(payload: AuthorizePayload): Promise<void> | void {
  if (isGooglePaymentData(payload)) {          // "tokenizationData" in payload
    callbacks.current.onGooglePayAuthorize(payload);
    return;
  }
  return callbacks.current.onAuthorize(payload); // Apple Pay
}
```

E o contrato de retorno é **oposto** nas duas carteiras:

| | Apple Pay | Google Pay |
|---|---|---|
| Quando o `onAuthorize` roda | com a sheet aberta | com a folha **já fechada** |
| O que o retorno faz | rejeitar → falha na sheet | nada; o SDK ignora |
| Onde o comprador vê o resultado | na sheet da Apple | na **nossa** tela |

⚠️ No Google Pay, **não lance** para sinalizar recusa: o SDK não aguarda nem
captura a Promise, e o erro vira uma unhandled rejection no console. Por isso o
`onGooglePayAuthorize` de [`app/page.tsx`](app/page.tsx) trata tudo
localmente:

```ts
const onGooglePayAuthorize = useCallback(async (paymentMethodData) => {
  const { orderId, customerId, installments, form } = latest.current;
  if (googlePaymentLockRef.current === orderId) return;   // trava (abaixo)
  googlePaymentLockRef.current = orderId;
  setStep("processing");
  try {
    const res = await fetch("/api/checkout/google-pay", { /* … paymentMethodData */ });
    if (!res.ok) throw new Error(/* motivo da Appmax */);
    setStep("success");
  } catch (error) {
    googlePaymentLockRef.current = null;  // libera nova tentativa
    setStep("error");                     // a mensagem é nossa
  }
}, []);
```

⚠️ **A trava por pedido é de propósito.** Depois de cada autorização o SDK
relê o `onUpdate` e prepara a folha de novo, e o botão continua clicável. Sem
a `googlePaymentLockRef`, um segundo clique no mesmo pedido dispara um segundo
`POST /v1/payments/google-pay`. É o mesmo esquema do cartão, em
[`FLUXO-CARTAO.md`](FLUXO-CARTAO.md) §3.

Se o comprador **fechar a folha** sem confirmar (`CANCELED`), o SDK não chama
nem `onAuthorize` nem `onError`. É desistência: não mostre erro, o botão
continua disponível.

## 5. Repasse o `paymentMethodData` sem tocar

O objeto chega assim:

```json
{
  "type": "CARD",
  "description": "Visa •••• 1234",
  "info": { "cardNetwork": "VISA", "cardDetails": "1234", "assuranceDetails": { … } },
  "tokenizationData": { "type": "PAYMENT_GATEWAY", "token": "{\"signature\":\"…\",…}" }
}
```

⚠️ O `token` é uma **string** que contém JSON. Não aplique `JSON.parse`, e não
remova `info` (a Appmax usa bandeira e últimos dígitos no comprovante).
Qualquer alteração dá `400 Invalid Google Pay token`. O browser manda o objeto
como chegou e o backend repassa como recebeu.

## 6. `POST /api/checkout/google-pay`

[`app/api/checkout/google-pay/route.ts`](app/api/checkout/google-pay/route.ts)
→ [`lib/appmax/googlePay.ts`](lib/appmax/googlePay.ts) →
`POST /v1/payments/google-pay`, com o token do **merchant**:

```json
{
  "order_id": 3,
  "customer_id": 7,
  "payment_data": {
    "google_pay": {
      "installments": 1,
      "holder_document_number": "51425014038",
      "soft_descriptor": "MINHALOJA",
      "payment_data": { "...": "o paymentMethodData inteiro" }
    }
  }
}
```

A rota valida antes de chamar a Appmax:

- `tokenizationData.token` presente e **string**, e `info.cardNetwork`
  presente;
- `installments` inteiro de **1 a 12**. No Google Pay o teto é fixo, mesmo
  que a loja tenha parcelamento estendido no cartão.

Erros da Appmax chegam em `{ errors: { message } }` (no `422` de validação,
`message` é um mapa `{ campo: [motivos] }`) e, no `403`, no envelope antigo
`{ success: false, data: { message } }`. O
[`lib/appmax/http.ts`](lib/appmax/http.ts) extrai a mensagem dos três
formatos, e ela chega à tela como veio (`Invalid Google Pay token`,
`Order Already Paid`…).

| Status | Significado |
|---|---|
| 201 | Aprovado. `data.payment.pay_reference` identifica a cobrança (estorno, conciliação) |
| 400 | `Invalid Google Pay token`, `Document number invalid`, pedido já pago, cancelado ou estornado |
| 401 | Token ausente/expirado, ou emitido com credencial do **app** em vez do merchant |
| 403 | Documento em lista restritiva |
| 404 | `Order not found` |
| 422 | Validação de campos, ou cartão não aceito pela Appmax: trate como recusa |
| 500 | Falha inesperada; se persistir, suporte com o `order_id` |

## Diagnóstico — sintoma → causa

| Sintoma | Causa provável |
|---|---|
| Botão não aparece no Safari | Esperado: com Apple Pay disponível, o SDK esconde o Google Pay (§1) |
| Botão não aparece no Chrome | Sem conta Google logada ou sem cartão salvo; ou âncora ausente no DOM durante o `init()` (§2) |
| Bloco vazio de 48 px no lugar do botão | O iframe foi inserido, mas o Google respondeu que não há como pagar neste navegador. O SDK não avisa a página |
| Nem Apple Pay nem Google Pay aparecem | `onUpdate` ou `onAuthorize` ausente ou com nome errado (§1) |
| Botão cortado | Âncora sem altura, ou com `display: none` (§2) |
| Folha mostra valor errado | `total` em centavos ou como string no `onUpdate`, ou carrinho mudou depois do carregamento (§3) |
| Folha mostra o nome errado da loja | Falta `data-appmax-merchant-name` no `[data-appmax-checkout]` (§2) |
| Folha não abre, sem nada no console | Checkout rodando dentro de um iframe sem `allow="payment"` |
| `Unhandled promise rejection` depois de autorizar | `onAuthorize` lançando no Google Pay (§4) |
| `400 Invalid Google Pay token` | `paymentMethodData` alterado no caminho (§5) |
| `onError` com `GOOGLE_PAY_FAILED` e mensagem vaga | O iframe só repassa uma string, sem `status`/`details`. Olhe o Network tab do iframe |
| Pagamento disparado duas vezes | Segundo clique no mesmo pedido. A trava por pedido (§4) evita a cobrança dupla |

## Como conferir você mesmo

Com o checkout aberto (pedido criado) e o SDK carregado, no console do browser:

```js
// a âncora existe e foi ocultada pelo SDK
document.querySelector("[data-appmax-google-pay]");

// o iframe da Appmax foi inserido antes dela, com altura e allow corretos
[...document.querySelectorAll("iframe")].map((f) => ({
  src: f.src,          // .../google-pay/iframe/
  height: f.style.height, // "48px" (altura da âncora)
  allow: f.allow,      // "payment https://<host do iframe>"
}));

// o wrapper só fica oculto se a carteira não estiver disponível
getComputedStyle(document.querySelector("[data-appmax-google-pay-wrapper]")).display;
```

O conteúdo do iframe é de outra origem: dali para dentro não dá para
inspecionar pelo console da página. Para ver a troca de mensagens, use o
seletor de contexto do DevTools (o dropdown "top") e escolha o iframe da
Appmax.
