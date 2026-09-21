# Appmax App Store — demo de checkout em Next.js

Demo de referência de como integrar o **Appmax JS** (`appmax.min.js`) num
projeto **Next.js / server-side**, cobrindo os dois meios de pagamento que
dependem de tokenização no browser: **Apple Pay** e **cartão de crédito**.

Feito especificamente para quem vai integrar num app com **App Router do
Next.js** (Server Components, Route Handlers, runtime Node). A documentação
oficial fica em **[docs.appmax.com.br](https://docs.appmax.com.br)** — este
repositório é o código que acompanha os guias, não um substituto deles.

> ⚠️ **Não é código de produção.** É um mapa do território: mostra onde cada
> chamada acontece e o que aprendemos rodando o fluxo de ponta a ponta. Antes
> de copiar para produção, leia "Limitações conhecidas" e "Antes de expor isto
> num túnel público" no fim deste documento.

## O que ele mostra

- Fluxo completo de **instalação** do app na App Store da Appmax
  (`/app/authorize` → health check → `/app/client/generate`), guiado pela
  tela [`/setup`](app/setup/page.tsx).
- Credenciais editáveis em tela ([`/configuracao`](app/configuracao/page.tsx)),
  salvas num **SQLite local** por ambiente (sandbox/produção) — sobrepõem as
  env vars, sem precisar de redeploy pra trocar de app/merchant. Inclui o
  **domínio do Apple Pay** registrado na instalação (`domain_name`), que nem
  sempre é o host onde este app roda.
- **Seletor de ambiente ativo** (sandbox/produção) no header, visível em
  toda página — troca sozinha qual linha do banco é usada (instalação,
  checkout, `/configuracao`), sem redeploy nem editar `APPMAX_ENV`.
- Checkout de teste (produto fixo, R$ 5,00) com **Apple Pay** — fluxo
  GERENCIADO pelo `appmax.min.js` (ele monta o botão, valida o merchant e
  abre a `PaymentSheet` sozinho).
- Checkout com **cartão de crédito tokenizado** (`data-appmax-checkout`),
  enviando o token pro backend, nunca o número do cartão.
- Domínio do Apple Pay servido em
  [`.well-known/apple-developer-merchantid-domain-association`](<app/.well-known/apple-developer-merchantid-domain-association/route.ts>)
  como Route Handler, com `Content-Type: text/plain` exato.
- Todas as chamadas que precisam de segredo (`client_secret`, tokens OAuth2)
  ficam em Route Handlers (`app/api/**/route.ts`) — o browser nunca vê essas
  credenciais.

## Pré-requisitos

1. **Conta de desenvolvedor na Appmax** com CNPJ ativo, pra criar um app em
   [appstore.appmax.com.br](https://appstore.appmax.com.br).
2. **Um túnel HTTPS público** pro `next dev` (ex.:
   [ngrok](https://ngrok.com)). A Appmax não alcança `localhost` — nem pro
   health check de instalação, nem pro Apple Pay.
3. **Safari** (macOS ou iOS) com pelo menos um cartão Visa/Mastercard
   cadastrado na Apple Wallet, só pra testar o Apple Pay — o botão só aparece
   nesse navegador.
4. Node 20+ e `pnpm` (o `better-sqlite3` usado em `/configuracao` compila um
   binário nativo no `pnpm install` — normal, é isso mesmo).

## Subindo tudo do zero

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

1. **Tenha uma URL pública HTTPS.** Ex.: `ngrok http 3000`. Nada pra
   configurar — a URL pública usada no callback de instalação e no domínio
   do Apple Pay é **detectada sozinha** a partir do `Host` de cada
   requisição (ver [`lib/appmax/config.ts`](lib/appmax/config.ts)). Só use
   a URL do túnel pra acessar o app a partir de agora (não `localhost`).

2. Abra `/setup` **pela URL pública** (não por `localhost`) — ela mostra a
   URL de validação exata a colar no painel do app.

   > ⚠️ Não teste essa rota com `curl`. Ela exige um corpo JSON com `app_id`
   > (sem ele responde `400`) e, o mais importante, **gera um `external_id`
   > novo e grava por cima do anterior a cada chamada** — rodá-la depois de
   > instalado quebra a tokenização até você reinstalar. Quem deve chamá-la é
   > a Appmax, durante o passo 4.

3. Crie o aplicativo em appstore.appmax.com.br (tipo **privado**), colando a
   URL de validação. Depois, em "Consultar Aplicativo → Desenvolver", copie
   `APPMAX_APP_UUID`, `APPMAX_APP_NUMERICAL_ID`, `APPMAX_APP_CLIENT_ID` e
   `APPMAX_APP_CLIENT_SECRET`. Preencha em **`/configuracao`** (recomendado —
   não precisa de redeploy) ou nas env vars.

   O `external_id` você não precisa gerar: o health check do passo 4 cria e
   salva no banco — um UUID **novo a cada requisição**, como a
   [doc exige](https://docs.appmax.com.br/guides/implementar-url-validacao)
   (a Appmax rejeita repetidos: um id que ela já conhece é descartado e
   trocado pelo `client_id` da instalação). Ele é lido **exclusivamente** da
   linha do ambiente ativo no SQLite (`/configuracao`) — **não existe
   fallback de env var**. Se estiver vazio, o checkout nem carrega o
   `appmax.min.js` e mostra o erro
   na tela, em vez de deixar o SDK falhar com `404 "Merchant not found"`
   mais adiante.

4. Volte para `/setup` e clique em **"Iniciar instalação"**. Você é
   redirecionado pro painel da Appmax pra autorizar (nesse fluxo de teste,
   você mesmo faz o papel do merchant). A Appmax chama nosso health check
   (`/api/appmax/validate`) e troca o hash pelas credenciais do merchant. O
   navegador termina em `/api/setup/callback`, mostrando
   `APPMAX_MERCHANT_CLIENT_ID`/`APPMAX_MERCHANT_CLIENT_SECRET` — já ficam
   salvas em `/configuracao` sozinhas (dev local); em runtime serverless,
   copie manualmente pras env vars.

5. Acesse `/` (também pela URL pública) para testar o checkout.

   ```bash
   curl -s https://SEU-TUNEL/api/appmax/public-config | jq
   ```

## Troubleshooting

| Sintoma | Causa provável |
|---|---|
| Health check devolve 500 | Filesystem somente-leitura (serverless): sem banco não há onde persistir o `external_id` — ver `lib/appmax/state.ts` |
| Checkout mostra "external_id não configurado" | A linha do ambiente ativo em `/configuracao` está sem `external_id`. Rode a instalação em `/setup` (o health check preenche) — env var não cobre mais isso |
| Botão do Apple Pay não aparece | Não é Safari, sem cartão na Wallet, ou o container `.appmax-apple-pay-btn` não existia no DOM quando o `init()` rodou — ver [`FLUXO-APPLE-PAY.md`](FLUXO-APPLE-PAY.md) §2 |
| `cart.total.toFixed is not a function` | `onUpdate` devolvendo o formato errado — números **em reais**, não string nem centavos. Ver [`FLUXO-APPLE-PAY.md`](FLUXO-APPLE-PAY.md) §3 |
| Apple Pay funciona em produção mas não em sandbox | Limitação conhecida — merchant session sempre falha em sandbox (ver "Limitações") |
| `/configuracao` devolve 500 ao salvar | Banco local não pôde ser aberto (filesystem somente-leitura); use env vars nesse runtime |
| Cartão: `onError` "Failed to process payment: Failed to tokenize card." | Mensagem genérica do SDK para qualquer falha na tokenização. Na forma de objeto, a causa real vem em `status`/`details`; na posicional, olhe o `POST .../tokenize` no Network tab — quase sempre é `404 "Merchant not found"`, ou seja, `external_id` que a Appmax não conhece |
| `invalid_client` no health check/checkout | Credenciais do app ou do merchant não batem com o ambiente ativo — confira `/configuracao` (banco tem prioridade sobre env var; uma env var velha esquecida no `.env` pode mascarar uma credencial nova e correta) |

## AppmaxJS — onde entra em cada tela

| Callback / hook | Onde | Função |
|---|---|---|
| `AppmaxScripts.init({ externalId, onIp, onTokenize, onError, onUpdate, onAuthorize })` | [`useAppmaxScripts.ts`](app/components/useAppmaxScripts.ts) | Carrega o bundle e inicializa o SDK. Forma de objeto, o padrão deste projeto |
| `onIp({ ip })` / `onTokenize({ token })` | idem | Um callback por evento. Substituem o `onSuccess` no respectivo evento |
| `onError({ code, message, stage, status, details })` | idem | Falhas de qualquer etapa. O `status` é o que diferencia `external_id` errado (`404`) de payload inválido (`422`) |
| `onSuccess(data)` | idem | Forma posicional (legada, via `APPMAX_SCRIPT_API=legacy`): **polimórfico** — objeto `{ ip }` na coleta de IP, **string crua** no token do cartão. `data.token` é `undefined` |
| `onUpdate()` | [`app/page.tsx`](app/page.tsx) | Monta o carrinho da `PaymentSheet` do Apple Pay — números **em reais**, não centavos |
| `onAuthorize(appleToken)` | idem | Recebe o Apple Token; precisa **rejeitar a Promise** em falha, não devolver `false` |
| `form[data-appmax-customer]` | [`AppmaxIpForm.tsx`](app/components/AppmaxIpForm.tsx) | Gatilho da coleta de IP (só a presença no DOM) e pré-requisito do listener do cartão |
| `[data-appmax-checkout]` | [`CreditCardForm.tsx`](app/components/CreditCardForm.tsx) | Form de tokenização de cartão |
| `.appmax-apple-pay-btn` | [`ApplePayButton.tsx`](app/components/ApplePayButton.tsx) | Container sempre montado onde o SDK injeta o botão nativo |
| Contrato completo | [`lib/appmax/scripts.ts`](lib/appmax/scripts.ts) | Tipos, seletores e nomes de campo — o arquivo a ler primeiro |

👉 Para o passo a passo de como implementar isso **do zero num projeto seu**,
veja [`TOKENIZACAO-CARTAO-NEXTJS.md`](TOKENIZACAO-CARTAO-NEXTJS.md).

## Apple Pay — passo a passo pra testar de verdade

1. Suba o app e acesse pela URL do túnel (`ngrok http 3000` ou parecido).
2. Complete a instalação (`/setup`) — isso registra o domínio do Apple Pay
   via `domain_names` em `/app/authorize` e o `.well-known/...` fica
   acessível na raiz do seu domínio automaticamente (Route Handler já
   incluso).
3. Abra `/` **no Safari** (macOS ou iOS), pela URL pública.
4. Preencha o form e clique "Continuar". O IP já foi coletado pelo SDK no
   carregamento da página (sem reload), então o pedido é criado direto e o
   botão do Apple Pay aparece.
5. Toque no botão. A `PaymentSheet` nativa abre; ao confirmar,
   `onAuthorize` recebe o token e `POST /api/checkout/apple-pay` efetiva o
   pagamento.

⚠️ **Limitação conhecida**: a validação da merchant session **só funciona em
produção** — em sandbox ela retorna `"Failed to get session"` de forma
consistente (testamos). Pra testar Apple Pay de verdade, `APPMAX_ENV` precisa
ser `production` e o pagamento usa dinheiro real (estorne pelo painel admin
depois).

## Cartão de crédito — passo a passo

1. Preencha o form do comprador e clique em "Continuar" — isso cria o
   customer e a order. O form de cartão então aparece junto com o botão do
   Apple Pay.
2. Preenche número, nome impresso, validade e CVV — campos marcados com
   os `name` obrigatórios (ver [`app/components/CreditCardForm.tsx`](app/components/CreditCardForm.tsx)).
3. Ao submeter, o `appmax.min.js` intercepta, tokeniza e entrega o token no
   `onTokenize({ token })` (ou como **string crua** no `onSuccess`, na forma
   posicional). Daí chamamos `POST /api/checkout/credit-card` →
   `POST /v1/payments/credit-card`
   (ver [`lib/appmax/creditCard.ts`](lib/appmax/creditCard.ts)).

✅ **Funciona em sandbox** — pagamento aprovado ponta a ponta. Ver
[`FLUXO-CARTAO.md`](FLUXO-CARTAO.md) para o contrato completo, incluindo a
trava de idempotência por pedido.

## Estrutura

```
lib/appmax/
  scripts.ts      CONTRATO do appmax.min.js (tipos, seletores, campos)
  config.ts       URLs sandbox/produção; credenciais do app (banco > env var)
  state.ts        external_id (só banco) + credenciais do merchant (banco > env var)
  http.ts         fetch helpers (auth OAuth2 + API com envelope { data })
  auth.ts         cache de token do app e do merchant (expiram em 1h)
  install.ts      POST /app/authorize, POST /app/client/generate
  customers.ts    POST /v1/customers
  orders.ts       POST /v1/orders
  applePay.ts     POST /v1/payments/apple-pay
  creditCard.ts   POST /v1/payments/credit-card

lib/checkout/
  product.ts      produto fixo do checkout de teste
  testData.ts     comprador e cartão fictícios

lib/db/
  client.ts       abre/cria .appmax/appmax.db (SQLite, better-sqlite3)
  credentials.ts  CRUD de credenciais por ambiente
  settings.ts     ambiente ativo (sandbox/produção) — uma linha só, global

app/api/
  appmax/validate/route.ts       health check da instalação
  appmax/public-config/route.ts  config não sensível pro front (script URL, externalId)
  setup/install/route.ts         inicia o fluxo de instalação (redirect pra Appmax)
  setup/callback/route.ts        troca o hash pelas credenciais do merchant
  setup/status/route.ts          status da instalação (debug)
  configuracao/route.ts          GET/POST das credenciais em /configuracao
  environment/route.ts           GET/POST do ambiente ativo (sandbox/produção)
  checkout/route.ts              cria customer + order
  checkout/apple-pay/route.ts    efetiva o pagamento com o appleToken
  checkout/credit-card/route.ts  efetiva o pagamento com o token de cartão

app/.well-known/apple-developer-merchantid-domain-association/route.ts
                  serve o arquivo de verificação de domínio do Apple Pay

app/
  page.tsx                        checkout de teste (estado + composição)
  setup/page.tsx                  passo a passo + status da instalação
  configuracao/page.tsx           credenciais editáveis em tela, por ambiente
  components/
    useAppmaxScripts.ts           carrega o appmax.min.js e devolve o IP
    AppmaxIpForm.tsx              gatilho da coleta de IP
    CreditCardForm.tsx            form que o SDK tokeniza
    ApplePayButton.tsx            container do botão gerenciado pelo SDK
    CustomerForm.tsx              etapa 1 (comprador) — React puro
    ExternalIdOverride.tsx        ferramenta de dev: sobrepõe o external_id
    EnvironmentSwitcher.tsx       seletor sandbox/produção, no Header
    ResetInstallButton.tsx        zera a instalação do ambiente ativo
    Header.tsx                    navegação compartilhada
```

## Rotas da API

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/appmax/validate` | Health check chamado pela Appmax durante a instalação |
| GET | `/api/appmax/public-config` | Config não sensível pro front |
| GET | `/api/setup/install` | Inicia `/app/authorize`, redireciona pra Appmax |
| GET | `/api/setup/callback` | Troca o hash pelas credenciais do merchant |
| GET | `/api/setup/status` | Status atual da instalação |
| POST | `/api/setup/reset` | Zera a instalação do ambiente ativo |
| GET/POST | `/api/configuracao` | Lê/edita credenciais por ambiente |
| GET/POST | `/api/environment` | Lê/troca o ambiente ativo (sandbox/produção) |
| POST | `/api/checkout` | Cria customer + order |
| POST | `/api/checkout/apple-pay` | Efetiva pagamento via Apple Pay |
| POST | `/api/checkout/credit-card` | Efetiva pagamento via cartão tokenizado |
| GET | `/.well-known/apple-developer-merchantid-domain-association` | Verificação de domínio do Apple Pay |

## Limitações conhecidas

- **Apple Pay só funciona de verdade em produção.** A validação de
  domínio/merchant é sempre feita contra a infraestrutura de produção da Apple,
  mesmo em sandbox — não existe merchant session de sandbox. Ver
  [`/api-reference/payments/apple-pay`](https://docs.appmax.com.br/api-reference/payments/apple-pay).
- **Cartão funciona em sandbox**, ponta a ponta — ver
  [`FLUXO-CARTAO.md`](FLUXO-CARTAO.md).
- **A trava de pagamento por pedido em `app/page.tsx` é de propósito.** Um
  token a mais chegando significa cobrança duplicada com dinheiro real, então
  a trava fica mesmo com o SDK entregando um token por submit.
- **`.appmax/appmax.db`/`state.json`** guardam segredos em texto puro, só
  para conveniência em dev/teste — não é o padrão recomendado pela Appmax
  para produção real (lá isso deveria virar uma tabela vinculada ao
  merchant, com os devidos controles de acesso).
- Em runtime serverless (Vercel), filesystem é somente-leitura — nem o
  SQLite nem o `state.json` sobrevivem entre invocações. Credencial de
  merchant ainda tem fallback de env var
  (`APPMAX_MERCHANT_CLIENT_ID/SECRET`); o `external_id`, **não** — ali o
  banco precisa ser externo/persistente de verdade.
- Produto único, fixo (R$ 5,00) — sem carrinho real.

## ⚠️ Antes de expor isto num túnel público

Este projeto é uma **bancada de testes**, e deliberadamente não tem as
proteções que um app real precisa. Use credenciais de **sandbox** e um túnel
que só você conhece.

- **`/configuracao` e `/setup` não têm autenticação nenhuma.** Qualquer um com
  a URL pode ler as credenciais mascaradas, trocá-las, zerar a instalação ou
  gerar uma nova. Fica bem enquanto só você acessa via ngrok; nunca deixe
  exposto sem login por trás.
- **`/api/setup/callback` imprime o `client_secret` do merchant na tela**, em
  texto plano — é o fluxo de teste, em que você faz o papel do merchant. Num
  app real essa credencial nunca deveria ser renderizada.
- **`/api/appmax/validate` é público e gera um `external_id` novo a cada
  chamada**, gravando por cima do anterior. Quem deve chamá-lo é a Appmax,
  durante a instalação; qualquer outra chamada quebra a tokenização até você
  reinstalar.
- **Segredos no SQLite/`state.json` ficam em texto plano** (o `.appmax/` é
  gitignorado, mas não é criptografado).
- Sem validação de assinatura de webhook — este projeto não recebe webhooks,
  mas se for adicionar, valide a origem. Ver
  [`/guides/webhooks`](https://docs.appmax.com.br/guides/webhooks).

Nenhum desses atalhos é recomendação da Appmax para produção.

## Comandos

```bash
pnpm dev     # servidor de desenvolvimento
pnpm build   # build de produção
pnpm start   # roda o build
pnpm lint    # eslint
```

## Referências

- [docs.appmax.com.br](https://docs.appmax.com.br) — documentação oficial
- [`/guides/appmax-js`](https://docs.appmax.com.br/guides/appmax-js) — AppmaxJS (IP, tokenização, Apple Pay)
- [`/api-reference/payments/apple-pay`](https://docs.appmax.com.br/api-reference/payments/apple-pay)
- [`/api-reference/payments/cartao-credito`](https://docs.appmax.com.br/api-reference/payments/cartao-credito)
- [`/guides/exemplo-checkout-spa`](https://docs.appmax.com.br/guides/exemplo-checkout-spa) — a versão resumida deste projeto, na doc oficial
- [`/guides/instalacao`](https://docs.appmax.com.br/guides/instalacao) — instalação do app na loja
- [`/guides/external-id`](https://docs.appmax.com.br/guides/external-id) — o identificador que mais dá problema

### Neste repositório

- [`TOKENIZACAO-CARTAO-NEXTJS.md`](TOKENIZACAO-CARTAO-NEXTJS.md) — **guia de implementação** da tokenização de cartão num projeto Next.js
- [`FLUXO-INSTALACAO.md`](FLUXO-INSTALACAO.md), [`FLUXO-APPLE-PAY.md`](FLUXO-APPLE-PAY.md), [`FLUXO-CARTAO.md`](FLUXO-CARTAO.md) — aprofundamento de cada fluxo, linha a linha
- [`FINGERPRINT-E-IP.md`](FINGERPRINT-E-IP.md) — como obter o fingerprint pelo SDK e qual dos dois gatilhos de coleta de IP usar
