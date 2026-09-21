# Fluxo de cartão de crédito — passo a passo

> Este arquivo mapeia o fluxo sobre os arquivos **deste repositório**. Para o
> passo a passo de como implementar do zero num projeto seu, veja
> [`TOKENIZACAO-CARTAO-NEXTJS.md`](TOKENIZACAO-CARTAO-NEXTJS.md); o contrato
> oficial do SDK está em
> [`/guides/appmax-js`](https://docs.appmax.com.br/guides/appmax-js).

> ✅ **Funciona em sandbox.** O endpoint de tokenização do sandbox responde
> `201` normalmente. Se der `404`, o problema é o `external_id` — ver a
> tabela de diagnóstico no fim.

Mapa em uma tela:

```
Browser (app/page.tsx)         appmax.min.js              /api/checkout/credit-card
 │                                  │                          │
 │  AppmaxScripts.init({            │                          │
 │    externalId, onIp,             │                          │
 │    onTokenize, ... }) ──────────>│                          │
 │                                  │  onIp({ ip })            │
 │  <───────────────────────────────│  (no init — sem          │
 │                                  │   submit, §1)            │
 │  preenche form                   │                          │
 │  data-appmax-checkout            │                          │
 │  submit ────────────────────────>│                          │
 │                                  │  POST .../v1/payments/   │
 │                                  │  tokenize                │
 │                                  │  header: external-id     │
 │  onTokenize({ token }) <─────────│  (ou onSuccess, §4)      │
 │                                  │                          │
 │  submitCreditCardPayment(token)  │                          │
 │───────────────────────────────────────────────────────────>│
 │                                  │                          │  POST /v1/payments/
 │                                  │                          │  credit-card
 │  aprovado/rejeitado <──────────────────────────────────────│
```

## 1. A coleta de IP — o pré-requisito escondido

A Appmax exige o IP do comprador em `POST /v1/customers`, e quem coleta é o
SDK. O gatilho é a **presença** de um `form[data-appmax-customer]` no DOM
durante o `init()` — ver
[`app/components/AppmaxIpForm.tsx`](app/components/AppmaxIpForm.tsx), que é
literalmente `<form data-appmax-customer hidden />`.

Sem submit e sem reload: o SDK busca o IP e chama `onSuccess({ ip })` durante
a própria inicialização. Depois ele anexa um `<input type="hidden" name="ip">`
ao form, o que só faz sentido num checkout clássico (o submit nativo levaria o
IP ao servidor). Numa SPA esse input é ignorado — o valor já chegou pelo
callback. Por isso o form fica **sem filhos**: quem escreve ali dentro é o SDK.

⚠️ **Não troque o form por `<span class="appmax-ip">`.** O SDK aceita os dois
como gatilho de IP, mas o caminho do `.appmax-ip` faz `return` **antes** de
registrar o listener do form de cartão (`setupFormSubmission()`). A tokenização
simplesmente para de funcionar, sem erro no console. Ver o pseudocódigo no
[Apêndice A do guia](TOKENIZACAO-CARTAO-NEXTJS.md#apêndice-a--o-que-o-sdk-faz-por-dentro).

> Como o SDK inicializa duas vezes (§3), ele também coleta o IP duas vezes e
> anexa dois inputs `ip` ao form. Para o IP isso é inofensivo.

## 2. O form — `data-appmax-checkout` + os `name` dos campos

Ver [`app/components/CreditCardForm.tsx`](app/components/CreditCardForm.tsx).

| Campo | `name` (lido pelo SDK) | `appmax-form-element` |
|---|---|---|
| Número do cartão | `card-number` | `number` |
| Nome impresso | `card-holder-name` | `holder_name` |
| Mês de validade | `exp-month` | `expiration_month` |
| Ano de validade | `exp-year` | `expiration_year` |
| CVV | `cvv` | `cvv` |

**Quem manda é o `name`.** O SDK lê os valores com `new FormData(form)`, pelos
`name` — eles não são livres. O atributo `appmax-form-element` é o que a
documentação oficial pede nos exemplos; o SDK não o lê, mas fica no código por
consistência com eles.

Input controlado ou não controlado tanto faz: `FormData` lê a propriedade
`value` do DOM, que o React mantém sincronizada. Neste projeto o nome do
titular é controlado (o backend precisa dele no payload) e os demais usam
`defaultValue` só para vir preenchidos com o cartão de teste.

O form fica **sempre montado**, escondido via CSS quando ainda não há pedido.
Isso é obrigatório: o SDK registra o listener de submit uma única vez, durante
o `init()`, e um form que nasce depois nunca é interceptado — mesma pegadinha
do container do Apple Pay.

O ano aceita 2 ou 4 dígitos (`31` e `2031` ambos tokenizam) — testado.

⚠️ **O `preventDefault()` é nosso, não do SDK.** Quem normalmente barra o
submit nativo é o listener do SDK, mas ele só existe depois do `init()` — que é
assíncrono e ainda espera uma chamada de rede. Um clique nessa janela faria o
browser dar `POST` de verdade na rota, que responde `405` e derruba a SPA. Por
isso o `onSubmit` do `CreditCardForm` chama `e.preventDefault()` por conta
própria.

## 3. ⚠️ A trava de idempotência por pedido

Uma tokenização por submit é o comportamento normal do SDK, e chamar `init()`
de novo **substitui** o handler do form em vez de empilhar — então nem o
StrictMode do React causa cobrança dupla.

Mesmo assim, este projeto trava o pagamento por pedido, e a recomendação é que a
sua integração faça o mesmo. O motivo é a assimetria do risco: a consequência de
um segundo token chegar é uma cobrança duplicada com dinheiro real do comprador,
e a de um `if` a mais é nada.

Um detalhe que só aparece na hora: **de-duplicar por token não funciona.** Cada
tokenização devolve um token diferente, então dois submits geram dois tokens
válidos e distintos. A chave da trava tem que ser o **pedido** — é o que
`cardPaymentLockRef` faz em [`app/page.tsx`](app/page.tsx). Ela é um `useRef`
(não `useState`) porque precisa estar posta de forma síncrona, antes de qualquer
`await`.

A trava é **liberada no `catch`**: o pagamento não aconteceu, então o retry
precisa passar. Por isso o form de cartão continua visível no estado de erro.

## 4. Onde o token chega — `onTokenize` ou `onSuccess`

O `init()` aceita duas formas, e o payload de sucesso depende de qual você usou.
Este projeto suporta as duas (`APPMAX_SCRIPT_API`), com a de objeto como padrão.

**Forma de objeto (recomendada).** Um callback por evento, cada um com payload
próprio — não há nada a discriminar:

```js
AppmaxScripts.init({
  externalId,
  onIp: ({ ip }) => { /* coleta de IP */ },
  onTokenize: ({ token }) => { /* token do cartão */ },
  onError: ({ code, stage, status, details }) => { /* falhas */ },
});
```

**Forma posicional (legada).** O `onSuccess` é **polimórfico**: o mesmo callback
atende os dois eventos, com formatos diferentes.

```js
onSuccess({ ip: "191.255.101.152" })   // coleta de IP — objeto
onSuccess("f4a9c1e0-...")              // token do cartão — STRING CRUA
```

É a pegadinha mais cara dessa forma: ler `data.token` dá `undefined` (é uma
string, não objeto) e o pagamento **morre em silêncio** — a tokenização retorna
`201` e nada mais acontece, sem erro e sem requisição.

Em [`app/components/useAppmaxScripts.ts`](app/components/useAppmaxScripts.ts) a
discriminação sai dos helpers `readCardToken` / `readIp`
([`lib/appmax/scripts.ts`](lib/appmax/scripts.ts)), que aceitam os dois
formatos — assim o resto do componente não precisa saber qual forma está ativa.

## 5. `submitCreditCardPayment(token)`

Em [`app/page.tsx`](app/page.tsx) — mesmo formato de `submitApplePayment`
(ver [`FLUXO-APPLE-PAY.md`](FLUXO-APPLE-PAY.md)), só troca o endpoint:

```ts
await fetch("/api/checkout/credit-card", {
  method: "POST",
  body: JSON.stringify({ orderId, customerId, token, installments, holderDocumentNumber, holderName }),
});
```

## 6. `POST /api/checkout/credit-card`

[`app/api/checkout/credit-card/route.ts`](app/api/checkout/credit-card/route.ts)
→ [`lib/appmax/creditCard.ts`](lib/appmax/creditCard.ts) →
`POST /v1/payments/credit-card` (`/api-reference/payments/cartao-credito`):

```json
{
  "order_id": 123,
  "customer_id": 456,
  "payment_data": {
    "credit_card": {
      "token": "...",
      "holder_document_number": "...",
      "holder_name": "...",
      "installments": 1,
      "soft_descriptor": "..."
    }
  }
}
```

O número do cartão e o CVV **nunca** chegam nesse endpoint — só o `token`
já gerado pelo `appmax.min.js` no browser.

## O que o SDK manda pra tokenizar

Útil pra reproduzir no `curl` quando algo falha:

```
POST https://<host>/v1/payments/tokenize
headers: content-type: application/json
         external-id: <o external_id da instalação>
body: {"payment_data":{"credit_card":{
        "number","holder_name","expiration_month","expiration_year","cvv"}}}

201: {"data":{"token":"..."}}  → o SDK devolve data.token (string) pro onSuccess
!ok: o SDK lança Error("Failed to tokenize card.") — para QUALQUER status
```

`origin`, `referer` e os `sec-fetch-*` **não** influenciam em nada —
testado trocando todos. Só o `external-id` decide.

O host é embutido no bundle em tempo de build e **é diferente em cada
ambiente** — é por isso que carregar o script de sandbox com o `external_id` de
produção (ou o contrário) devolve `404 "Merchant not found"`. Para ver o host
que está em uso, olhe a requisição no Network tab. Ver
[`/guides/ambientes`](https://docs.appmax.com.br/guides/ambientes).

## Diagnóstico — sintoma → causa

| Sintoma | Causa provável |
|---|---|
| `onError`: `"Failed to process payment: Failed to tokenize card."` | Genérico do SDK pra QUALQUER falha na tokenização. Abra o Network tab e olhe o status real do `POST .../tokenize` |
| `404 {"message":"Merchant not found"}` no tokenize | O `external_id` enviado não existe no registro de merchants daquele ambiente. Não é o endpoint fora do ar. Confira o log `[Appmax] init() com external_id=…` e reinstale se preciso |
| `400 Missing required request parameters: [external-id]` | `init()` rodou sem `external_id` — o checkout deveria ter bloqueado antes |
| O submit não faz **nada** (sem erro, sem requisição) | O form não existia no DOM durante o `init()`, ou há um `.appmax-ip` na página desligando o listener do cartão (§1) |
| Tokeniza com `201` mas nada acontece depois | Na forma posicional, lendo `data.token` num `onSuccess` que recebeu string (§4) |
| Dois pagamentos no mesmo pedido | Dois submits chegaram ao SDK (clique duplo, ou o form submetido por outro caminho) — é para isso que existe a trava por pedido (§3) |
| O browser navega pra fora / `405` ao pagar | Faltou o `preventDefault()` próprio e o clique caiu antes do `init()` (§2) |
| `POST /v1/payments/credit-card` devolve 400 | Confira se `installments` é `number` — no Apple Pay o mesmo campo vai como string. Ver a referência de cada endpoint |
| Trocar o `external_id` não muda a request | O SDK captura o valor no construtor e não tem teardown — só recarregando a página. O código força o reload sozinho |
