# Fluxo de instalação — passo a passo

Mapa em uma tela:

```
Você                  /setup              Appmax                /api/appmax/validate   /api/setup/callback
 │                      │                    │                          │                       │
 │  clica "Iniciar       │                    │                          │                       │
 │  instalação" ────────>│                    │                          │                       │
 │                      │ POST /app/authorize │                          │                       │
 │                      │───────────────────>│                          │                       │
 │                      │  { token: hash }    │                          │                       │
 │                      │<───────────────────│                          │                       │
 │  redireciona pra     │                    │                          │                       │
 │  admin.appmax.com.br │                    │                          │                       │
 │<──────────────────────────────────────────│                          │                       │
 │  você autoriza                            │                          │                       │
 │  (faz o papel do merchant) ───────────────>│                          │                       │
 │                      │                    │  GET url_callback?token= │                       │
 │                      │                    │─────────────────────────────────────────────────>│
 │                      │                    │                          │  POST /app/client/     │
 │                      │                    │                          │  generate (troca hash) │
 │                      │                    │<─────────────────────────────────────────────────│
 │                      │                    │  chama health check      │                       │
 │                      │                    │─────────────────────────>│                       │
 │                      │                    │  200 { external_id }     │                       │
 │                      │                    │<─────────────────────────│                       │
 │                      │                    │  { client_id, secret }   │                       │
 │                      │                    │─────────────────────────────────────────────────>│
 │  vê client_id/secret na tela, copia se precisar                      │                       │
 │<──────────────────────────────────────────────────────────────────────────────────────────────│
```

## 1. `POST /app/authorize`

[`lib/appmax/install.ts`](lib/appmax/install.ts) (`authorizeInstall`):

- Usa o **App UUID** (`APPMAX_APP_UUID`), não o Numerical ID — mandar o
  numérico aqui devolve `422`. Ver
  [`/guides/identificadores-do-app`](https://docs.appmax.com.br/guides/identificadores-do-app).
- Manda `url_callback` apontando pra
  [`/api/setup/callback`](app/api/setup/callback/route.ts) — é pra onde a
  Appmax redireciona depois que você autoriza.
- Manda **os dois nomes** de campo pro domínio do Apple Pay —
  `domain_name` (singular) e `domain_names` (array). A API aceita os dois
  (o singular é o retrocompatível), então mandar ambos é redundante de
  propósito: um domínio não registrado só se manifesta como merchant session
  falhando muito depois, e a instalação não pode ser refeita sem reinstalar.
  Ver [`/guides/instalacao`](https://docs.appmax.com.br/guides/instalacao).
- O **domínio** vem de `getApplePayDomain()`: o valor salvo em
  [`/configuracao`](app/configuracao/page.tsx) para o ambiente ativo e, se
  estiver vazio, o host da requisição atual. Ver a seção abaixo — é o único
  dado da instalação que costuma precisar ser diferente de onde este app
  roda.
- Devolve um `hash` de uso único e a `redirectUrl` pra tela de autorização.

Disparado por [`app/api/setup/install/route.ts`](app/api/setup/install/route.ts),
que só redireciona (`NextResponse.redirect`) pra `redirectUrl`.

### O domínio do Apple Pay

O domínio registrado aqui é o da **página onde a PaymentSheet abre** — não o
da sua API, e não necessariamente o host deste app de instalação. Dois motivos
para poder fixá-lo em `/configuracao` em vez de sempre derivar do `Host`:

1. **Eles podem ser diferentes.** O checkout do lojista pode estar num domínio
   e a instalação rodar em outro.
2. **O valor fica congelado no momento da instalação.** Se você registrar o
   host de um túnel de desenvolvimento e o túnel reiniciar com outra URL, a
   merchant session passa a falhar e não há como corrigir sem reinstalar.

O campo aceita a URL completa e guarda só o domínio: `https://Loja.com.br/checkout`
vira `loja.com.br`. Isso é obrigatório — a Apple rejeita o registro com
`domainName must be a fully qualified domain name without scheme or path`.

Salvar o campo **vazio** volta ao comportamento automático (host da
requisição). O valor que será efetivamente registrado aparece em
[`/setup`](app/setup/page.tsx), em "Domínio do Apple Pay", antes de você
clicar em "Iniciar instalação".

Lembre que o `.well-known/apple-developer-merchantid-domain-association`
precisa estar acessível **nesse mesmo domínio** — ver
[`FLUXO-APPLE-PAY.md`](FLUXO-APPLE-PAY.md).

## 2. Você autoriza como merchant

Nesse fluxo de teste, você mesmo desempenha o papel do merchant sendo
instalado — é a mesma pessoa criando o app E autorizando a instalação. Em
produção real, quem autoriza é o lojista de verdade.

## 3. A Appmax chama `url_callback` com `?token=<hash>`

Cai em [`app/api/setup/callback/route.ts`](app/api/setup/callback/route.ts),
que lê o `token` da query string e chama `generateMerchantClient(hash)`.

## 4. `POST /app/client/generate`

[`lib/appmax/install.ts`](lib/appmax/install.ts)
(`generateMerchantClient`): troca o hash pelas credenciais do merchant
(`client_id`/`client_secret`). **É durante essa chamada, do lado da Appmax,
que ela dispara o health check** contra a URL de validação que você colou no
painel do app ao criar o aplicativo.

⚠️ Se o health check falhar (próximo passo), a instalação inteira falha
aqui — mesmo que `/app/client/generate` em si estivesse OK.

## 5. Health check — `POST /api/appmax/validate`

[`app/api/appmax/validate/route.ts`](app/api/appmax/validate/route.ts) —
**precisa responder exatamente `200`** com `{ external_id }` (a doc é
explícita: `201`/`204` e outros `2xx` **não** valem).

Com uma ressalva deliberada: se o `external_id` gerado **não puder ser
persistido**, a rota responde `500` de propósito e derruba a instalação.
Responder `200` nesse caso registraria do lado da Appmax um id que este app
não teria — que é exatamente a fábrica de `404 "Merchant not found"` que a
gente passou dias caçando. Melhor falhar na instalação, com mensagem clara,
do que "concluir" e quebrar no primeiro pagamento.

O `external_id` devolvido aqui é o **mesmo valor** que o
`AppmaxScripts.init(...)` no front vai usar depois — por isso ele é
persistido no banco (linha do ambiente ativo, visível em
[`/configuracao`](app/configuracao/page.tsx)), sempre por cima do anterior.

E ele é **novo a cada requisição**, nunca reaproveitado. A
[doc](https://docs.appmax.com.br/guides/implementar-url-validacao) é
explícita: *"Gere um UUID novo a cada requisição do health check"* — a
Appmax **rejeita valores repetidos**, e quando o `external_id` enviado já
existe na base dela ele é descartado e substituído pelo `client_id` da
instalação. Reaproveitar era exatamente o que fazia o id salvo aqui não
existir do lado da Appmax, com sintoma só lá na frente: `404
{"message":"Merchant not found"}` em toda tokenização de cartão.

⚠️ **Não chame esta rota à mão depois de instalado.** Como ela gera um id novo
a cada requisição e grava por cima do anterior, um `curl` de teste
**rotaciona** o `external_id` — o banco passa a ter um valor que a Appmax nunca
viu, e toda tokenização volta `404 "Merchant not found"` até você reinstalar.

Esse banco é a **única** fonte: `getExternalId()` não olha env var nem
`state.json`. Um `APPMAX_EXTERNAL_ID` esquecido no `.env` vencia o valor
salvo pela instalação e fazia o SDK mandar um id desconhecido — 404
`{"message":"Merchant not found"}` no `/v1/payments/tokenize`, que chega no
front como o genérico `"Failed to tokenize card."`.

## 6. Resultado — credenciais do merchant

De volta em `app/api/setup/callback/route.ts`, as credenciais
(`client_id`/`client_secret`) são renderizadas na própria resposta — e não num
redirect com querystring, onde o `client_secret` ficaria em logs e no histórico
do navegador. Elas também são persistidas via `lib/appmax/state.ts` →
`lib/db/credentials.ts` (SQLite, uma linha por ambiente), visíveis depois em
[`/configuracao`](app/configuracao/page.tsx).

Nenhuma credencial é escrita em log, nem mascarada: o corpo do health check
pode conter `client_secret`, então ele também não é logado.

## Diagnóstico — sintoma → causa

| Sintoma | Causa provável |
|---|---|
| `/app/authorize` retorna 401 | `APPMAX_APP_CLIENT_ID/SECRET` errados ou não preenchidos (env var ou `/configuracao`) |
| Health check nunca é chamado | URL de validação colada errada no painel do app — confira com `/setup` |
| Health check retorna 500 | Banco indisponível (filesystem somente-leitura) — não há onde persistir o `external_id` |
| Merchant session falha só depois que o túnel reiniciou | O domínio registrado na instalação era o host do túnel antigo. Fixe o domínio em `/configuracao` e reinstale |
| `domainName must be a fully qualified domain name without scheme or path` | Domínio salvo com `https://` ou caminho — o campo normaliza, mas um valor vindo de env var/banco antigo não |
| Checkout diz "external_id não configurado" | A linha do ambiente ativo está sem `external_id`: rode a instalação, ou cole o valor em `/configuracao` |
| Callback cai em erro "hash inválido" | Reusou um `token` de uma tentativa anterior — cada `/app/authorize` gera um hash de uso único |
| Credenciais do merchant não aparecem em `/configuracao` | Filesystem somente-leitura (serverless) — copie da tela de resultado do callback pras env vars manualmente |
