# Tokenizar cartão de crédito com o Appmax JS num projeto Next.js

Guia passo a passo para implementar a tokenização de cartão com o
**Appmax JS** (`appmax.min.js`) numa aplicação **Next.js com App Router**.

Ao final você terá um checkout em que o número do cartão nunca passa pelo seu
servidor: o browser tokeniza direto com a Appmax e o seu backend recebe apenas
um token de uso único.

Todo o código deste guia está implementado e funcionando neste repositório —
cada passo aponta o arquivo correspondente.

O contrato oficial do SDK está em
[`/guides/appmax-js`](https://docs.appmax.com.br/guides/appmax-js), e a versão
resumida deste guia, na doc, em
[`/guides/exemplo-checkout-spa`](https://docs.appmax.com.br/guides/exemplo-checkout-spa).

---

## Índice

1. [O que você vai construir](#1-o-que-você-vai-construir)
2. [Antes de começar](#2-antes-de-começar)
3. [As quatro regras do Appmax JS](#3-as-quatro-regras-do-appmax-js)
4. [Passo 1 — Entregar o `external_id` ao browser](#passo-1--entregar-o-external_id-ao-browser)
5. [Passo 2 — Carregar e inicializar o SDK](#passo-2--carregar-e-inicializar-o-sdk)
6. [Passo 3 — O gatilho da coleta de IP](#passo-3--o-gatilho-da-coleta-de-ip)
7. [Passo 4 — O formulário de cartão](#passo-4--o-formulário-de-cartão)
8. [Passo 5 — Receber o token](#passo-5--receber-o-token)
9. [Passo 6 — A trava de idempotência do pagamento](#passo-6--a-trava-de-idempotência-do-pagamento)
10. [Passo 7 — Criar cliente e pedido](#passo-7--criar-cliente-e-pedido-backend)
11. [Passo 8 — Efetivar o pagamento](#passo-8--efetivar-o-pagamento-backend)
12. [Juntando tudo](#juntando-tudo)
13. [Checklist antes de ir para produção](#checklist-antes-de-ir-para-produção)
14. [Diagnóstico — sintoma → causa](#diagnóstico--sintoma--causa)
15. [Apêndice A — a requisição de tokenização](#apêndice-a--a-requisição-de-tokenização)
16. [Apêndice B — por que não `next/script`](#apêndice-b--por-que-não-nextscript)

---

## 1. O que você vai construir

O fluxo tem **seis etapas**, e é importante ver desde já quem faz o quê. As
etapas em **negrito** acontecem no browser; as demais, no seu servidor.

```
┌──────────────────────── BROWSER ────────────────────────┐   ┌──── SEU SERVIDOR ────┐   ┌─── APPMAX ───┐
│                                                         │   │                      │   │              │
│  1. carrega appmax.min.js ───────────────────────────────────────────────────────────>│  bundle       │
│                                                         │   │                      │   │              │
│  2. AppmaxScripts.init(...)                             │   │                      │   │              │
│     └─ coleta o IP do comprador  ────────────────────────────────────────────────────>│  coleta de IP │
│        onIp({ ip }) <─────────────────────────────────────────────────────────────────│              │
│                                                         │   │                      │   │              │
│  3. usuário preenche nome/e-mail/CPF                    │   │                      │   │              │
│     POST /api/checkout  ───────────────────────────────────>│ POST /v1/customers ─────>│ customer_id  │
│                                                         │   │ POST /v1/orders    ─────>│ order_id     │
│     { customerId, orderId } <───────────────────────────────│                      │   │              │
│                                                         │   │                      │   │              │
│  4. usuário preenche o cartão e dá submit               │   │                      │   │              │
│     o SDK intercepta e tokeniza  ────────────────────────────────────────────────────>│ /tokenize     │
│        onTokenize({ token }) <────────────────────────────────────────────────────────│              │
│                                                         │   │                      │   │              │
│  5. POST /api/checkout/credit-card ────────────────────────>│ POST /v1/payments/      │              │
│                                                         │   │      credit-card   ─────>│ aprovado?    │
│  6. mostra o resultado  <───────────────────────────────────│                      │   │              │
└─────────────────────────────────────────────────────────┘   └──────────────────────┘   └──────────────┘
```

**A regra de ouro:** o número do cartão e o CVV existem apenas dentro do
formulário no browser. Eles vão direto do browser para a Appmax. O seu servidor
só vê o `token`.

---

## 2. Antes de começar

Você precisa de quatro coisas. As três primeiras vêm do fluxo de instalação do
aplicativo na Appmax (documentado em
[`FLUXO-INSTALACAO.md`](FLUXO-INSTALACAO.md)):

| O que | Onde usar | Como obter |
|---|---|---|
| `external_id` | **no browser**, no `init()` do SDK | devolvido por você no health check da instalação e registrado pela Appmax |
| `client_id` / `client_secret` do **merchant** | só no servidor | resposta de `POST /app/client/generate`, ao final da instalação |
| URL do bundle | no browser | `https://scripts.sandboxappmax.com.br/appmax.min.js` (sandbox) ou `https://scripts.appmax.com.br/appmax.min.js` (produção) |
| HTTPS público | sempre | a Appmax não alcança `localhost`; em desenvolvimento use um túnel (ngrok, cloudflared) |

> ⚠️ **O `external_id` é o item mais importante e o que mais dá problema.** Ele
> é o único identificador que a tokenização usa para saber de qual loja o
> cartão é. Se ele não bater com o que a Appmax registrou na instalação, **toda
> tokenização volta `404 {"message":"Merchant not found"}`** — e o erro chega
> ao seu código como a mensagem genérica `"Failed to tokenize card."`, que não
> aponta em nada para a instalação. Guarde-o num banco, associado à loja.

Sandbox e produção são **registros separados**: um `external_id` de sandbox não
funciona em produção e vice-versa.

---

## 3. As quatro regras do Appmax JS

Se você ler só uma seção deste documento, leia esta. Quase todo problema de
integração é uma destas quatro regras sendo violada.

**Regra 1 — `external_id` é pré-requisito, não configuração opcional.**
Sem ele, o `init()` lança uma exceção **síncrona**
(`External ID is required for Apple Pay use.`) e o submit do cartão também
lança, de dentro do listener — nenhum dos dois chega no seu `onError`. O guard
certo é não carregar o SDK enquanto você não tiver o id.

**Regra 2 — o `init()` roda UMA vez por carga de página.**
Chamar `init()` de novo **substitui** o handler do formulário em vez de
empilhar, então um submit continua gerando uma tokenização — nem o StrictMode do
React causa cobrança dupla. Mas cada chamada refaz a coleta de IP e o
fingerprint, e o `external_id` é capturado na primeira e não é relido depois. Se
o `external_id` mudar (troca de loja, troca de ambiente), o único caminho é
recarregar a página.

**Regra 3 — os elementos precisam existir no DOM ANTES do `init()`.**
O SDK faz `querySelector` uma única vez e não observa mudanças no DOM. Um
formulário que aparece depois — atrás de um `if`, de um passo do checkout, de
uma rota — **nunca é interceptado**, e o submit não faz absolutamente nada: sem
erro, sem log, sem requisição. Em React, renderize sempre e esconda com CSS
(`hidden`), nunca com renderização condicional.

**Regra 4 — escolha a forma do `init()` de propósito.**
O `init()` aceita duas assinaturas, e o payload dos callbacks depende de qual
você usou. Para código novo, use a **forma de objeto**: um callback por evento,
sem nada a discriminar.

```ts
AppmaxScripts.init({
  externalId,
  onIp: ({ ip }) => { /* coleta de IP */ },
  onTokenize: ({ token }) => { /* token do cartão */ },
  onError: ({ code, stage, status, details }) => { /* falhas, estruturadas */ },
});
```

A **forma posicional** continua suportada e não será removida, mas o `onSuccess`
dela é polimórfico — o mesmo callback recebe tipos diferentes:

```ts
onSuccess({ ip: "191.255.101.152" })   // coleta de IP — um OBJETO
onSuccess("f4a9c1e0-...")              // token do cartão — uma STRING crua
```

É a pegadinha mais cara dessa forma: o token **não** vem dentro de um objeto, e
se você escrever `data.token` recebe `undefined` e o pagamento morre em silêncio
— a tokenização responde `201` e nada mais acontece. Se precisar mantê-la,
discrimine com `typeof data === "string"`.

---

## Passo 1 — Entregar o `external_id` ao browser

O `external_id` fica no seu banco, mas quem precisa dele é o código do browser.
Exponha-o numa rota pública — ele **não é segredo** (é só um identificador de
loja), ao contrário do `client_secret`, que nunca pode sair do servidor.

📄 [`app/api/appmax/public-config/route.ts`](app/api/appmax/public-config/route.ts)

```ts
import { NextResponse } from "next/server";
import { getAppmaxBaseUrls, getAppmaxEnvironment } from "@/lib/appmax/config";
import { getExternalId, getMerchantCredentials } from "@/lib/appmax/state";

export async function GET() {
  const { scriptUrl } = getAppmaxBaseUrls();

  return NextResponse.json({
    environment: getAppmaxEnvironment(),
    scriptUrl,                                   // muda entre sandbox e produção
    externalId: getExternalId(),                 // identificador da loja
    merchantConfigured: Boolean(getMerchantCredentials()),
  });
}
```

**O que NÃO colocar aqui:** `client_id`, `client_secret` ou qualquer
`access_token`. Esses ficam em Route Handlers que chamam a Appmax pelo
servidor.

> 💡 Por que não uma variável `NEXT_PUBLIC_*`? Porque o `external_id` é gerado
> durante a instalação e é **por loja**. Se você o fixar no build, trocar de
> loja ou reinstalar exige um redeploy — e um valor desatualizado é exatamente
> a causa do `404 "Merchant not found"`.

---

## Passo 2 — Carregar e inicializar o SDK

Este é o coração da integração. Concentre todo o ciclo de vida do SDK num hook,
para que o resto do checkout seja React comum.

📄 [`app/components/useAppmaxScripts.ts`](app/components/useAppmaxScripts.ts)

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { AppleToken, AppmaxCheckoutData } from "@/lib/appmax/scripts";

export function useAppmaxScripts({
  scriptUrl, externalId, onCardToken, onError, getCheckoutData, onAuthorize,
}: Params): { ip: string | null } {
  const [ip, setIp] = useState<string | null>(null);

  // Os callbacks ficam num ref: o init() roda uma vez e não pode depender
  // da identidade deles, senão re-executaria a cada render.
  const callbacks = useRef({ onCardToken, onError, getCheckoutData, onAuthorize });
  useEffect(() => {
    callbacks.current = { onCardToken, onError, getCheckoutData, onAuthorize };
  }, [onCardToken, onError, getCheckoutData, onAuthorize]);

  const initializedFor = useRef<string | null>(null);

  useEffect(() => {
    // REGRA 1: sem external_id, nem carrega o script.
    if (!scriptUrl || !externalId) return;

    // REGRA 2: uma inicialização por carga de página.
    if (initializedFor.current) {
      if (initializedFor.current !== externalId) window.location.reload();
      return;
    }

    let cancelled = false;

    function init() {
      if (cancelled || !window.AppmaxScripts || initializedFor.current) return;
      initializedFor.current = externalId;

      // Log proposital: é a primeira coisa a conferir num "Merchant not found".
      console.log(`[Appmax] init() com external_id=${externalId}`);

      // REGRA 4: forma de objeto — um callback por evento.
      window.AppmaxScripts.init({
        externalId,
        onIp: ({ ip }) => setIp(ip),
        onTokenize: ({ token }) => callbacks.current.onCardToken(token),
        onError: (err) => callbacks.current.onError(err),
        onUpdate: () => callbacks.current.getCheckoutData(),        // só Apple Pay
        onAuthorize: (appleToken) => callbacks.current.onAuthorize(appleToken), // só Apple Pay
      });
    }

    if (window.AppmaxScripts) { init(); return; }

    // Reaproveita a tag se já existir (o StrictMode monta o efeito 2× em dev).
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", init);
    if (!existing) {
      script.src = scriptUrl;
      script.async = true;
      script.addEventListener("error", () =>
        callbacks.current.onError(new Error(`Falha ao carregar ${scriptUrl}`)));
      document.head.appendChild(script);
    }

    return () => { cancelled = true; script.removeEventListener("load", init); };
  }, [scriptUrl, externalId]);

  return { ip };
}
```

### As duas assinaturas do `init()`

**Forma de objeto** — a recomendada, e a usada acima:

```ts
AppmaxScripts.init({
  externalId,    // string    — obrigatório para tokenizar e para Apple Pay
  onIp,          // ({ ip }) => void
  onTokenize,    // ({ token }) => void
  onError,       // ({ code, message, stage, status?, details? }) => void
  onUpdate,      // () => AppmaxCheckoutData              — só Apple Pay
  onAuthorize,   // (appleToken) => Promise<void>         — só Apple Pay
});
```

Informe só os callbacks dos eventos que te interessam. Se você não faz Apple
Pay, omita `onUpdate` e `onAuthorize`.

**Forma posicional** — legada, mantida por compatibilidade:

```ts
AppmaxScripts.init(onSuccess, onError, externalId, onUpdate, onAuthorize);
```

Ela não dá acesso aos callbacks por evento: o `onSuccess` recebe os dois
payloads (Regra 4) e o `onError` chega como string, apenas em falha de
tokenização. Este projeto suporta as duas — a variável `APPMAX_SCRIPT_API`
troca entre elas, para quem quiser comparar.

> ⚠️ Passar `onUpdate`/`onAuthorize` **sem** `externalId` faz o `init()` lançar
> de forma síncrona, dentro do `useEffect` — o que pode derrubar a árvore React
> inteira. O guard da Regra 1 evita isso.

> 💡 Na forma de objeto, toda falha chega ao `onError` com `code` e `stage`
> (`ip`, `fingerprint`, `setup`, `tokenize`), mais `status` e `details` quando
> veio da API. É o `status` que diferencia um `external_id` errado (`404`) de um
> payload inválido (`422`) — veja
> [o contrato do `onError`](https://docs.appmax.com.br/guides/appmax-js#o-contrato-do-onerror).

---

## Passo 3 — O gatilho da coleta de IP

A Appmax exige o IP do comprador em `POST /v1/customers`. Quem o coleta é o
SDK, mas **ele só faz isso se encontrar um elemento gatilho no DOM**.

O gatilho é um formulário vazio com o atributo `data-appmax-customer`. Basta
ele **existir** — sem submit, sem reload, sem nenhum campo dentro.

📄 [`app/components/AppmaxIpForm.tsx`](app/components/AppmaxIpForm.tsx)

```tsx
export default function AppmaxIpForm() {
  return <form data-appmax-customer hidden />;
}
```

Durante o `init()`, o SDK encontra esse form, busca o IP e chama
`onIp({ ip })`. Em seguida ele anexa um `<input type="hidden" name="ip">` ao
formulário — isso serve para um checkout clássico, em que o submit nativo
levaria o IP ao servidor. Numa SPA você ignora esse input: o valor já chegou
pelo callback, e o nó pode ser descartado no próximo re-render sem aviso.

**Por isso o form fica sem filhos:** quem escreve dentro dele é o SDK, e o React
não deve disputar essa parte da árvore.

> ⚠️ **Não troque este form por `<span class="appmax-ip">`.**
>
> O SDK aceita os dois elementos como gatilho de IP, mas com um `.appmax-ip` na
> página o `init()` **retorna antes de registrar o listener do formulário de
> cartão**. O submit do `data-appmax-checkout` deixa de fazer absolutamente
> nada — sem erro no console, sem callback, sem requisição.
>
> **Para checkout com cartão, o gatilho tem que ser o formulário.** O guia
> oficial só documenta o form; ver
> [`FINGERPRINT-E-IP.md`](FINGERPRINT-E-IP.md) para a comparação completa dos
> dois gatilhos.

### Ordem de montagem

O form precisa estar no DOM antes do `init()`. Em React isso sai de graça:
componentes filhos montam **antes** de os efeitos do pai rodarem. Basta
renderizar `<AppmaxIpForm />` na mesma página que chama o hook.

---

## Passo 4 — O formulário de cartão

O formulário é marcado com `data-appmax-checkout`. O SDK intercepta o `submit`,
lê os campos com `new FormData(form)` e tokeniza.

📄 [`app/components/CreditCardForm.tsx`](app/components/CreditCardForm.tsx)

### Os nomes dos campos são fixos

O SDK lê pelos atributos **`name`**, e eles não são livres:

| Campo | `name` (obrigatório) | `appmax-form-element` |
|---|---|---|
| Número do cartão | `card-number` | `number` |
| Nome impresso | `card-holder-name` | `holder_name` |
| Mês de validade | `exp-month` | `expiration_month` |
| Ano de validade | `exp-year` | `expiration_year` |
| CVV | `cvv` | `cvv` |

O atributo `appmax-form-element` aparece nos exemplos da documentação oficial e
vale manter por consistência, mas **quem decide é o `name`** — é ele que o
`FormData` usa. Os dois não têm os mesmos valores, o que é uma fonte fácil de
confusão: copie a coluna do `name` exatamente como está na tabela.

O ano aceita 2 ou 4 dígitos (`31` e `2031` tokenizam igual).

### O componente

```tsx
"use client";

import { CARD_FIELDS } from "@/lib/appmax/scripts";

export default function CreditCardForm({ visible, holderName, onHolderNameChange, onSubmit }) {
  return (
    <form
      data-appmax-checkout
      method="POST"
      // Sem este preventDefault, um clique ANTES de o SDK inicializar dispara
      // o submit nativo e o browser navega para fora da sua SPA.
      onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}
      // REGRA 3: sempre montado, escondido só por CSS.
      className={visible ? "" : "hidden"}
    >
      <input required name={CARD_FIELDS.number.name}          placeholder="Número do cartão" inputMode="numeric" />
      <input required name={CARD_FIELDS.holderName.name}      placeholder="Nome impresso"
             value={holderName} onChange={(e) => onHolderNameChange(e.target.value)} />
      <input required name={CARD_FIELDS.expirationMonth.name} placeholder="MM"   inputMode="numeric" />
      <input required name={CARD_FIELDS.expirationYear.name}  placeholder="AAAA" inputMode="numeric" />
      <input required name={CARD_FIELDS.cvv.name}             placeholder="CVV"  inputMode="numeric" />
      <button type="submit">Pagar com cartão</button>
    </form>
  );
}
```

### Três detalhes que não são estilo

**1. O `preventDefault()` é seu, não do SDK.**
Quem normalmente barra o submit nativo é o listener do SDK — mas ele só existe
depois do `init()`. Existe uma janela real entre a montagem do componente e a
inicialização do script (que é assíncrona e ainda espera uma chamada de rede).
Um clique nessa janela faz o browser dar `POST` de verdade na rota atual, que
no Next responde `405` e tira o usuário da aplicação no meio do checkout.

**2. O form fica sempre montado** (Regra 3). Trocar `hidden` por um `if` quebra
a tokenização em silêncio.

**3. Input controlado ou não controlado: tanto faz para o SDK.**
`FormData` lê a propriedade `value` do DOM, e o React a mantém sincronizada.
Use controlado onde o seu backend precisa do valor (o nome do titular vai no
payload do pagamento) e não controlado no resto.

---

## Passo 5 — Receber o token

O token chega no `onTokenize`, como `{ token }` (ou, na forma posicional, como
string crua no `onSuccess` — Regra 4). No hook do Passo 2 ele já foi
encaminhado para `onCardToken`:

```ts
const onCardToken = useCallback((token: string) => {
  console.log("[Appmax] token de cartão recebido");
  submitCreditCardPayment(token);   // manda para o SEU backend
}, [submitCreditCardPayment]);
```

O token é de **uso único** e de vida curta: use-o imediatamente em
`POST /v1/payments/credit-card`. Não armazene, não reaproveite.

---

## Passo 6 — A trava de idempotência do pagamento

O caminho normal entrega **um** token por submit: o SDK substitui o handler do
formulário a cada `init()` em vez de empilhar listeners, então nem o StrictMode
do React dispara duas tokenizações.

Implemente a trava de todo jeito. O motivo é a assimetria do risco: se um
segundo token chegar por qualquer via — um clique duplo do comprador, o
formulário submetido por outro caminho, um `init()` a mais num refactor futuro —
a consequência é uma **cobrança duplicada com dinheiro real**. A consequência de
um `if` redundante é nenhuma.

Um detalhe que só aparece na hora: **de-duplicar por token não funciona.** Cada
tokenização devolve um token diferente e igualmente válido, então dois submits
geram dois pagamentos distintos. A chave da trava tem que ser o **pedido**:

📄 [`app/page.tsx`](app/page.tsx)

```ts
const cardPaymentLockRef = useRef<number | null>(null);

const onCardToken = useCallback((token: string) => {
  const { orderId } = latest.current;

  // Trava SÍNCRONA, antes de qualquer await: um segundo token pode chegar logo
  // atrás do primeiro e precisa encontrar o lock já posto.
  if (cardPaymentLockRef.current === orderId) {
    console.warn(`[Appmax] segundo token para o pedido ${orderId} — ignorando.`);
    return;
  }
  cardPaymentLockRef.current = orderId;

  submitCreditCardPayment(token);
}, [submitCreditCardPayment]);
```

Dois pontos sutis:

- A trava é um **`useRef`, não `useState`**. `setState` é assíncrono; o segundo
  callback chegaria antes do re-render e passaria pela trava.
- **Libere a trava quando o pagamento falhar**, senão o usuário não consegue
  tentar de novo no mesmo pedido:

```ts
catch (error) {
  cardPaymentLockRef.current = null;   // o pagamento não aconteceu: retry precisa passar
  setStep("error");
}
```

> A mesma assimetria vale do outro lado: um `init()` repetido refaz a coleta de
> IP e o fingerprint. Para o IP isso é inofensivo (o valor é o mesmo); para o
> pagamento, é dinheiro. Chame `init()` uma vez por carga de página.

---

## Passo 7 — Criar cliente e pedido (backend)

A Appmax exige um `customer_id` e um `order_id` **antes** do pagamento. Crie os
dois no seu servidor, nessa ordem, assim que tiver o IP e os dados do
comprador.

📄 [`app/api/checkout/route.ts`](app/api/checkout/route.ts)

```ts
export async function POST(request: NextRequest) {
  const body = await request.json();

  const customer = await upsertCustomer({
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
    ip: body.ip,                       // veio do onSuccess({ ip }) do SDK
    documentNumber: body.documentNumber,
    address: body.address,
  });

  const order = await createOrder(customer.id);

  return NextResponse.json({ customerId: customer.id, orderId: order.id });
}
```

As chamadas à Appmax usam o **token OAuth2 do merchant**, obtido com
`client_credentials`. Ele expira em 1 hora e não há refresh token — vale
cachear em memória e renovar um pouco antes de expirar
(ver [`lib/appmax/auth.ts`](lib/appmax/auth.ts)).

> 💡 Cacheie o token **por ambiente**. Sandbox e produção têm emissores
> diferentes; um cache compartilhado manda um Bearer de sandbox para a API de
> produção e produz um `401` intermitente que some sozinho quando o token
> expira — quase impossível de reproduzir na hora.

---

## Passo 8 — Efetivar o pagamento (backend)

Com o token do cartão e os ids em mãos, chame
`POST /v1/payments/credit-card`.

📄 [`app/api/checkout/credit-card/route.ts`](app/api/checkout/credit-card/route.ts)
→ [`lib/appmax/creditCard.ts`](lib/appmax/creditCard.ts)

```ts
await appmaxApiRequest("POST", "/v1/payments/credit-card", {
  token: await getMerchantAccessToken(),
  body: {
    order_id: input.orderId,
    customer_id: input.customerId,
    payment_data: {
      credit_card: {
        token: input.token,                              // do Appmax JS
        holder_document_number: input.holderDocumentNumber,
        holder_name: input.holderName,
        installments: input.installments,                // NUMBER, 1 a 12
        soft_descriptor: input.softDescriptor,           // opcional, máx. 13 chars
      },
    },
  },
});
```

⚠️ `installments` aqui é **número**. (No pagamento com Apple Pay, a mesma
informação vai como *string* — uma inconsistência da API que rende um `400`
difícil de entender.)

### Propague o erro da Appmax

Não transforme tudo em `500`. O motivo da recusa está no corpo da resposta, e é
isso que o suporte vai pedir:

📄 [`lib/appmax/http.ts`](lib/appmax/http.ts)

```ts
export function appmaxErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppmaxApiError) {
    return NextResponse.json(
      { error: error.message, detail: error.body },
      { status: error.status >= 400 && error.status < 600 ? error.status : 502 },
    );
  }
  const message = error instanceof Error ? error.message : "Erro desconhecido";
  return NextResponse.json({ error: message }, { status: 500 });
}
```

---

## Juntando tudo

A página do checkout compõe as peças. O importante é a **ordem de montagem** e
o fato de os elementos do Appmax estarem sempre presentes:

📄 [`app/page.tsx`](app/page.tsx)

```tsx
"use client";

export default function CheckoutPage() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [cardHolderName, setCardHolderName] = useState("");

  useEffect(() => {
    fetch("/api/appmax/public-config").then((r) => r.json()).then(setConfig);
  }, []);

  const { ip } = useAppmaxScripts({
    scriptUrl: config?.scriptUrl ?? null,
    externalId: config?.externalId ?? null,
    onCardToken,
    onError: (err) => console.error("[Appmax]", err),
    getCheckoutData,   // só Apple Pay
    onAuthorize,       // só Apple Pay
  });

  const paymentsVisible = orderId !== null;

  return (
    <div>
      {/* Gatilho do IP: precisa existir antes do init() */}
      <AppmaxIpForm />

      {/* Etapa 1 — React comum, nada de Appmax aqui */}
      {!orderId && <CustomerForm ... onSubmit={handleContinue} />}

      {/* Etapa 2 — SEMPRE montado, só escondido */}
      <CreditCardForm
        visible={paymentsVisible}
        holderName={cardHolderName}
        onHolderNameChange={setCardHolderName}
      />
    </div>
  );
}
```

E o handler que cria o pedido:

```ts
async function handleContinue(e: React.FormEvent) {
  e.preventDefault();
  if (!ip) {
    setMessage("Aguardando a coleta de IP — ela acontece no carregamento da página.");
    return;
  }
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip, ...form }),
  });
  const data = await res.json();
  setOrderId(data.orderId);
  setCustomerId(data.customerId);
}
```

### Um detalhe de React que economiza horas

Os callbacks passados ao `init()` são registrados **uma única vez**. Se eles
lerem o state direto, vão enxergar para sempre os valores da primeira
renderização — o `orderId` seria `null` no momento do pagamento.

A solução é espelhar o estado num ref:

```ts
const latest = useRef({ orderId, customerId, installments, form, cardHolderName });
useEffect(() => {
  latest.current = { orderId, customerId, installments, form, cardHolderName };
}, [orderId, customerId, installments, form, cardHolderName]);

// dentro de qualquer callback do SDK:
const { orderId, customerId } = latest.current;   // sempre o valor atual
```

---

## Checklist antes de ir para produção

- [ ] `external_id` persistido por loja **e por ambiente**, lido do banco (não
      de variável de ambiente fixada no build).
- [ ] A URL do bundle troca entre sandbox e produção junto com o ambiente.
- [ ] O checkout **bloqueia** quando não há `external_id`, com mensagem clara,
      em vez de deixar o SDK falhar mais adiante.
- [ ] Trava de idempotência por pedido implementada e **liberada no erro**.
- [ ] `preventDefault()` próprio no formulário de cartão.
- [ ] Formulário de cartão e gatilho de IP sempre montados, escondidos por CSS.
- [ ] `client_secret` e tokens OAuth2 apenas em Route Handlers — nunca no
      browser, nunca em `NEXT_PUBLIC_*`.
- [ ] Token do merchant cacheado por ambiente.
- [ ] Erros da Appmax propagados com status e corpo originais — e, no front,
      o `onError` lendo `code`/`status`/`details` em vez de só a `message`.
- [ ] Testado em sandbox de ponta a ponta **com um `external_id` de sandbox**.

---

## Diagnóstico — sintoma → causa

| Sintoma | Causa provável |
|---|---|
| `onError`: `"Failed to process payment: Failed to tokenize card."` | Mensagem genérica do SDK para **qualquer** falha na tokenização. Abra o Network tab e veja o status real do `POST .../tokenize` |
| `404 {"message":"Merchant not found"}` no tokenize | O `external_id` enviado não existe no registro daquele ambiente. Não é o endpoint fora do ar. Compare com o que a instalação registrou |
| `400 Missing required request parameters: [external-id]` | `init()` rodou sem `external_id` |
| O submit do cartão não faz **nada** (sem erro, sem requisição) | O form não existia no DOM durante o `init()` (Regra 3) — ou existe um `.appmax-ip` na página, que desliga o listener do cartão |
| Tokeniza com `201`, mas nada acontece depois | Na forma posicional, você leu `data.token` num `onSuccess` que recebeu uma string (Regra 4) |
| Dois pagamentos no mesmo pedido | Dois submits chegaram ao SDK — é para isso que existe a trava por pedido (Passo 6) |
| O browser navega para fora da página ao pagar / erro `405` | Faltou o `preventDefault()` próprio, e o clique caiu na janela anterior ao `init()` |
| `POST /v1/payments/credit-card` devolve `400` | `installments` como string (aqui tem que ser número) |
| Trocar o `external_id` não muda a requisição | O valor é capturado no `init()` e não é relido — só recarregando (Regra 2) |
| `onIp`/`onSuccess` nunca dispara | Não há gatilho de IP no DOM — falta o `form[data-appmax-customer]` |
| `401` intermitente que some sozinho | Token OAuth2 do merchant cacheado sem separar por ambiente |

**Regra geral:** se a requisição de tokenização **não aparece** no Network tab,
o problema está no seu DOM ou no `init()`. Se ela aparece e volta erro, o
problema é o `external_id`. Esses dois mundos não se misturam.

---

## Apêndice A — a requisição de tokenização

Útil para reproduzir no `curl` quando algo falha, e para saber o que procurar no
Network tab. É o SDK que faz esta chamada — você não escreve nada disso:

```
POST https://<host-do-bundle>/v1/payments/tokenize
headers:
  content-type: application/json
  external-id: <o external_id da instalação>
body:
  {"payment_data":{"credit_card":{
     "number","holder_name","expiration_month","expiration_year","cvv"}}}

resposta 201: {"data":{"token":"..."}}
qualquer !ok: o SDK reporta "Failed to tokenize card." no onError, com o status
              e o corpo reais em `status` / `details` (forma de objeto)
```

Três coisas que essa requisição ensina:

- **O único header que identifica a loja é `external-id`.** Não há Bearer, e
  `origin` / `referer` / `sec-fetch-*` não influenciam em nada — testado
  trocando todos. Se a resposta é `404 "Merchant not found"`, o problema é o
  valor do `external_id`, não a origem da chamada nem o endpoint.
- **O host vem embutido no bundle**, em tempo de build, e é diferente em cada
  ambiente. É por isso que misturar o script de um ambiente com o `external_id`
  do outro dá `404`.
- **O número do cartão nunca passa pelo seu servidor.** Ele sai do formulário
  direto para a Appmax; o que chega ao seu backend é só o `token`.

O contrato completo do endpoint (incluindo o caminho alternativo via backend,
com Bearer do merchant, permitido apenas em escopo PCI-DSS) está em
[`/api-reference/payments/cartao-credito#tokenizacao`](https://docs.appmax.com.br/api-reference/payments/cartao-credito#tokenizacao).

---

## Apêndice B — por que não `next/script`

`next/script` é a forma idiomática de carregar scripts de terceiros no Next, e
funcionaria aqui com renderização condicional mais `onReady`. Ainda assim, este
projeto carrega o bundle manualmente, por dois motivos:

1. **Ele não resolve nenhuma das quatro regras.** A ordem do DOM, a
   inicialização única e o pré-requisito do `external_id` continuam por sua
   conta — que é exatamente onde as integrações quebram.
2. **Acoplamento.** O hook do Passo 2 é o arquivo que você vai copiar para o
   seu checkout. Sem `next/script`, ele é React puro e funciona em Next, Vite,
   Remix ou CRA sem alteração.

Se o seu projeto já padroniza `next/script`, use-o — só mantenha o guard do
`external_id` e o controle de inicialização única.

---

## Referências

- [docs.appmax.com.br/guides/appmax-js](https://docs.appmax.com.br/guides/appmax-js) — Appmax JS
- [/api-reference/payments/cartao-credito](https://docs.appmax.com.br/api-reference/payments/cartao-credito)
- [`FLUXO-INSTALACAO.md`](FLUXO-INSTALACAO.md) — como obter o `external_id` e as credenciais do merchant
- [`FLUXO-CARTAO.md`](FLUXO-CARTAO.md) — o mesmo fluxo, mapeado sobre os arquivos deste repositório
- [`FLUXO-APPLE-PAY.md`](FLUXO-APPLE-PAY.md) — o fluxo de Apple Pay, que compartilha o `init()`
