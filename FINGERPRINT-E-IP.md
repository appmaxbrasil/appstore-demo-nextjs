# Fingerprint e coleta de IP no Appmax JS

> Notas de apoio a este projeto. O contrato oficial das duas funcionalidades
> está em [`/guides/appmax-js`](https://docs.appmax.com.br/guides/appmax-js) —
> aqui ficam só os pontos que a gente precisou verificar no navegador ao montar
> este checkout, e que valem para quem estiver integrando.

Duas perguntas:

1. Como pegar o fingerprint pelo Appmax JS, e para que ele serve.
2. Existem dois gatilhos de coleta de IP (`.appmax-ip` e
   `form[data-appmax-customer]`). Qual usar em cada caso.

---

## 1. Fingerprint

É uma chamada direta, independente do `init()`. Devolve `Promise`, não passa por
callback e não precisa de `externalId` — basta o script estar carregado.

```js
const basico = await AppmaxScripts.getFingerprint();
const completo = await AppmaxScripts.getFingerprint({ meta: true });
```

`AppCheckout` e `AppmaxScripts` são o mesmo objeto, então tanto faz qual usar.
A lista completa de campos (e de sinais de `meta`) está na
[seção de fingerprint do guia](https://docs.appmax.com.br/guides/appmax-js#fingerprint-do-navegador).

### Onde usar

```js
// dispare no carregamento e guarde a Promise: com meta:true a coleta faz
// WebGL, media devices e vozes, e leva algumas centenas de ms
const fingerprintPromise = AppmaxScripts.getFingerprint({ meta: true });

// ...no submit
const fingerprint = await fingerprintPromise;
await fetch("/meu-backend/pagamento", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...dadosDoPagamento, fingerprint }),
});
```

### ⚠️ Duas coisas que não são óbvias

**Ninguém recebe esse valor automaticamente.** Ele fica no browser e só chega a
algum lugar se a sua aplicação enviar. Não existe endpoint da Appmax esperando
esse formato: na prática ele serve à análise de risco *da sua* operação.

**Não é o token do antifraude da Appmax.** O campo
`payment.Fingerprint.token`, que a API de pagamento aceita, é produzido por
outra biblioteca, com formato e propósito diferentes. Para alimentar o
antifraude da Appmax, este não é o caminho.

**Este projeto não chama `getFingerprint()`.** O `init()` calcula um
fingerprint internamente, mas o valor não chega a nenhum callback — se você
quiser o objeto, precisa chamar a função você mesmo.

---

## 2. Os dois gatilhos de coleta de IP

O SDK coleta o IP durante o `init()` — sem submit e sem reload. O que dispara a
coleta é a presença de um destes no DOM:

| | `class="appmax-ip"` | `<form data-appmax-customer>` |
| --- | --- | --- |
| Coleta o IP | sim | sim |
| Entrega no callback (`onIp` / `onSuccess`) | sim | sim |
| Injeta `<input type="hidden" name="ip">` | **não** | sim |
| Form de cartão continua funcionando | **NÃO** | sim |
| Precisa ser um `<form>` | não, qualquer elemento | sim |
| Documentado no guia oficial | não | sim |

### A pegadinha do `.appmax-ip`

Com um `.appmax-ip` na página, o `init()` retorna **antes** de registrar o
listener do formulário de cartão. O submit do `data-appmax-checkout` deixa de
fazer absolutamente nada — sem erro no console, sem callback, sem requisição.

O comportamento é antigo e foi preservado de propósito: mudá-lo faria páginas
hoje quebradas começarem a tokenizar de repente. O guia oficial parou de
recomendar a classe e passou a indicar o form vazio — e é por isso que este
projeto usa
[`AppmaxIpForm.tsx`](app/components/AppmaxIpForm.tsx) e não um `<span>`.

### O `.appmax-ip` não recebe o IP

O nome sugere que o elemento vira destino do valor. Não vira: a classe é apenas
**contada**, e nada é escrito dentro dela. É um sinalizador, não um campo.

Não confundir com o atributo `data-appmax-ip`, que o SDK põe no
`<input name="ip">` que ele injeta — coisas diferentes, e uma não dispara a
outra.

### Qual usar

**Checkout com cartão → sempre `form[data-appmax-customer]`.** É a única opção
que mantém a tokenização viva, e de quebra o IP já vai no seu POST pelo input
escondido.

**`.appmax-ip` → só em página sem tokenização de cartão.** Uma landing ou etapa
anterior onde você quer apenas o IP e vai tratá-lo no callback.

Na prática, `data-appmax-customer` faz tudo que a classe faz e mais, sem a
armadilha — a única vantagem real do `.appmax-ip` é funcionar em qualquer
elemento, quando não há formulário nenhum na página. E isso se resolve com um
`<form data-appmax-customer hidden></form>` vazio.

---

## Como conferir você mesmo

Com a aplicação rodando e o SDK carregado, no console do browser:

```js
// fingerprint
await AppmaxScripts.getFingerprint({ meta: true });

// gatilho de IP em uso e efeito no DOM
document.querySelectorAll(".appmax-ip").length;        // deve ser 0 aqui
document.querySelector("form[data-appmax-customer]");  // o gatilho
document.querySelectorAll('input[name="ip"]').length;  // deve ser 1
```
