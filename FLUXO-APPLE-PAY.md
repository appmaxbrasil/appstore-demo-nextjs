# Fluxo de Apple Pay — passo a passo

> Mapeia o fluxo sobre os arquivos **deste repositório**. O passo a passo
> oficial está em
> [`/api-reference/payments/apple-pay-appmax-js`](https://docs.appmax.com.br/api-reference/payments/apple-pay-appmax-js).

Mapa em uma tela:

```
Safari (app/page.tsx)          appmax.min.js              Apple Pay (Safari)        /api/checkout/apple-pay
 │                                  │                          │                          │
 │  AppmaxScripts.init({            │                          │                          │
 │    externalId, onIp,             │                          │                          │
 │    onTokenize, onUpdate,         │                          │                          │
 │    onAuthorize, ... }) ─────────>│                          │                          │
 │                                  │  injeta botão em          │                          │
 │                                  │  .appmax-apple-pay-btn    │                          │
 │  toque no botão ─────────────────>│                          │                          │
 │                                  │  abre ApplePaySession ───>│                          │
 │                                  │  chama onUpdate() <───────│  (monta PaymentSheet)    │
 │                                  │  obtém merchant session    │                          │
 │                                  │  (sozinho, no browser —    │                          │
 │                                  │   ver §5)                  │                          │
 │                                  │                          │  confirma pagamento ─────>│
 │                                  │  chama onAuthorize(token) <────────────────────────────│
 │  submitApplePayment(appleToken) │                          │                          │
 │──────────────────────────────────────────────────────────────────────────────────────>│
 │                                  │                          │  POST /v1/payments/       │
 │                                  │                          │  apple-pay                │
 │  aprova/rejeita a Promise <──────────────────────────────────────────────────────────────│
 │  session.completePayment(status)│                          │                          │
```

## 0. Pré-requisito: o domínio registrado

O Apple Pay só funciona no domínio que foi registrado em `POST /app/authorize`
durante a instalação, e que serve o arquivo
`.well-known/apple-developer-merchantid-domain-association`. Esse domínio é
configurável por ambiente em [`/configuracao`](app/configuracao/page.tsx) —
vazio significa "use o host da requisição atual". Ver
[`FLUXO-INSTALACAO.md`](FLUXO-INSTALACAO.md#o-domínio-do-apple-pay).

Como ele fica congelado no momento da instalação, um túnel de desenvolvimento
que reinicia com outra URL derruba a merchant session — por isso vale fixar um
domínio estável antes de instalar.

## 1. `AppmaxScripts.init(...)`

Em [`app/components/useAppmaxScripts.ts`](app/components/useAppmaxScripts.ts) — chamado
assim que o bundle carrega e a config do servidor chega. Fluxo
**gerenciado**: em vez de montar a `ApplePaySession` nós mesmos, o próprio
`appmax.min.js` cuida de tudo (botão, validação de merchant, `PaymentSheet`)
— a gente só passa os callbacks.

```ts
window.AppmaxScripts.init({
  externalId: effectiveExternalId, // obrigatório: sem ele nem carregamos o SDK
  onIp: ({ ip }) => setIp(ip),
  onTokenize: ({ token }) => onCardToken(token),  // cartão, não Apple Pay
  onError,
  onUpdate: getCheckoutData,
  onAuthorize,
});
```

⚠️ Sem `externalId`, passar `onUpdate`/`onAuthorize` faz o `init()` lançar
`"External ID is required for Apple Pay use."` de forma **síncrona** — dentro
do `useEffect`, o que pode derrubar a árvore React inteira. O código nunca
chega lá: um guard bloqueia o checkout — e nem carrega o `appmax.min.js` —
enquanto não houver `external_id` no banco.

⚠️ O `init()` roda **uma vez por carga de página**. O `externalId` é capturado
ali e não é relido, então trocar o valor em runtime não muda as requisições
seguintes. Quando o id muda, o código força `window.location.reload()`.

## 2. O container do botão precisa existir ANTES do `init()`

Em [`app/components/ApplePayButton.tsx`](app/components/ApplePayButton.tsx):

```tsx
<div className={`appmax-apple-pay-btn h-12 ${visible ? "" : "hidden"}`} />
```

O script procura esse container **só durante o `init()`**, uma vez — o `init`
não é reativo a mudanças no DOM. Se o container nascer depois (num `if`
condicional do React, por exemplo), o clique nunca é registrado — em silêncio,
sem erro nenhum. Por isso ele fica sempre montado no DOM, só escondido via
CSS.

## 3. `onUpdate()` — formato do carrinho

`getCheckoutData` em [`app/page.tsx`](app/page.tsx) (passado ao hook). O
retorno precisa ser exatamente:

```ts
{ orderId: string, total: number, freight: number, discount: number, installments: number, products: [...] }
```

`total`/`freight`/`discount`/preços dos produtos em **reais** (não centavos)
— passar centavos ou string quebra com `cart.total.toFixed is not a
function` dentro do próprio script.

## 4. `onAuthorize(appleToken)` — rejeitar, não retornar `false`

`onAuthorize` em [`app/page.tsx`](app/page.tsx):

```ts
const onAuthorize = useCallback(async (appleToken: AppleToken) => {
  const ok = await submitApplePayment(appleToken);
  if (!ok) throw new Error("Pagamento não aprovado");
}, [submitApplePayment]);
```

⚠️ O SDK entende falha **só por rejeição da Promise**. Se a função devolver
`false` sem lançar, o script chama `session.completePayment(STATUS_SUCCESS)`
mesmo com o pagamento tendo falhado — e o comprador vê "pagamento aprovado" no
Safari sem ter pago nada. Lance (ou rejeite) sempre.

## 5. Merchant session — quem obtém é o próprio script

A Apple revalida domínio e merchant a cada transação, no momento em que a
PaymentSheet abre. No fluxo gerenciado isso é **transparente**: quem obtém a
merchant session é o próprio `appmax.min.js`, no browser, com o `external_id`
da instalação — a chamada não envolve nenhum segredo seu e por isso não passa
pelo backend deste projeto.

É contra-intuitivo em Next.js, onde a reação natural é proxyar tudo pelo
servidor: aqui não há nada para proxyar. Ver o comentário em
[`lib/appmax/applePay.ts`](lib/appmax/applePay.ts).

Se você precisar montar a `ApplePaySession` na mão (controle total sobre a
PaymentSheet), aí sim existe um endpoint autenticado para isso:
[`POST /v1/apple-pay/merchant-session`](https://docs.appmax.com.br/api-reference/payments/apple-pay-merchant-session).
Este projeto não usa esse caminho.

## 6. `POST /api/checkout/apple-pay`

[`app/api/checkout/apple-pay/route.ts`](app/api/checkout/apple-pay/route.ts)
→ [`lib/appmax/applePay.ts`](lib/appmax/applePay.ts) →
`POST /v1/payments/apple-pay`. Recebe o `appleToken` cru (paymentData +
paymentMethod do Apple Pay nativo, repassado como veio) e o `orderId`/
`customerId` criados no passo anterior (`POST /api/checkout`).

## Diagnóstico — sintoma → causa

| Sintoma | Causa provável |
|---|---|
| Botão não aparece | Não é Safari, sem cartão na Wallet, ou container ausente no DOM durante o `init()` (§2) |
| `cart.total.toFixed is not a function` | `onUpdate` devolvendo formato errado (§3) — confira números em reais, não string/centavos |
| Cliente vê "aprovado" mas o pagamento falhou no backend | `onAuthorize` retornando `false` em vez de lançar (§4) |
| `init()` lança exceção síncrona na tela | Faltou `externalId` (§1) |
| Merchant session sempre falha, `"Failed to get session"` | **Limitação conhecida**: só funciona em produção (`APPMAX_ENV=production`) — sandbox falha essa validação de forma consistente |
| IP coletado duas vezes | `init()` rodou mais de uma vez — cada chamada refaz a coleta de IP e o fingerprint. Garanta uma chamada por carga de página |
| Pagamento disparado duas vezes | Dois submits chegaram ao SDK. A trava por pedido (ver [`FLUXO-CARTAO.md`](FLUXO-CARTAO.md) §3) é o que evita a cobrança dupla |
| Merchant session falha depois de trocar de ambiente | Token OAuth é cacheado por ambiente; se persistir, confira qual ambiente está ativo no seletor do Header |
