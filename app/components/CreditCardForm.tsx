"use client";

import { CARD_FIELDS } from "@/lib/appmax/scripts";
import { TEST_CARD } from "@/lib/checkout/testData";

type Props = {
  /** `true` depois que o pedido existe. Controla só a visibilidade — ver abaixo. */
  visible: boolean;
  /** O backend precisa do nome do titular no payload, então ele vive no React. */
  holderName: string;
  onHolderNameChange: (value: string) => void;
  /** Chamado no submit, antes de o SDK tokenizar (para limpar mensagens da tela). */
  onSubmit?: () => void;
};

const input =
  "rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple";

/**
 * Form de cartão tokenizado pelo Appmax JS.
 *
 * Este é o componente inteiro da tokenização: o SDK intercepta o submit, lê os
 * campos com `new FormData(form)` pelos atributos `name`, chama o endpoint de
 * tokenização com o header `external-id` e devolve o token em `onSuccess` —
 * como STRING crua. O número do cartão e o CVV nunca tocam o seu backend.
 *
 * Três coisas não são preferência de estilo:
 *
 * 1. **Os `name` são fixos** (`card-number`, `card-holder-name`, `exp-month`,
 *    `exp-year`, `cvv`) — é por eles que o `FormData` lê. Ver CARD_FIELDS.
 *
 * 2. **O form fica SEMPRE montado, só escondido via CSS.** O SDK registra o
 *    listener de submit uma única vez, durante o `init()`; um form que nasce
 *    depois nunca é interceptado, e o clique não faz nada — sem erro nenhum.
 *
 * 3. **O `onSubmit` precisa do `preventDefault()` próprio.** Quem normalmente
 *    barra o submit nativo é o listener do SDK, mas ele só existe depois do
 *    `init()`. Sem este guard, um clique na janela entre a montagem e o init
 *    faz o browser dar POST de verdade na rota e derrubar a página.
 *
 * O nome do titular é um input controlado; os demais usam `defaultValue`. Tanto
 * faz para o SDK — `FormData` lê a propriedade `value` do DOM, que o React
 * mantém sincronizada. A diferença é só que o backend precisa do nome e não
 * precisa dos outros.
 */
export default function CreditCardForm({
  visible,
  holderName,
  onHolderNameChange,
  onSubmit,
}: Props) {
  return (
    <form
      data-appmax-checkout
      method="POST"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
      className={`flex flex-col gap-3 ${visible ? "" : "hidden"}`}
    >
      <p className="text-sm text-am-ink-muted">Pague com cartão de crédito:</p>
      <input
        required
        placeholder="Número do cartão"
        defaultValue={TEST_CARD.number}
        inputMode="numeric"
        appmax-form-element={CARD_FIELDS.number.element}
        name={CARD_FIELDS.number.name}
        className={input}
      />
      <input
        required
        placeholder="Nome impresso no cartão"
        appmax-form-element={CARD_FIELDS.holderName.element}
        name={CARD_FIELDS.holderName.name}
        value={holderName}
        onChange={(e) => onHolderNameChange(e.target.value)}
        className={input}
      />
      <div className="grid grid-cols-3 gap-3">
        <input
          required
          placeholder="MM"
          defaultValue={TEST_CARD.expirationMonth}
          inputMode="numeric"
          appmax-form-element={CARD_FIELDS.expirationMonth.element}
          name={CARD_FIELDS.expirationMonth.name}
          className={input}
        />
        <input
          required
          placeholder="AAAA"
          defaultValue={TEST_CARD.expirationYear}
          inputMode="numeric"
          appmax-form-element={CARD_FIELDS.expirationYear.element}
          name={CARD_FIELDS.expirationYear.name}
          className={input}
        />
        <input
          required
          placeholder="CVV"
          defaultValue={TEST_CARD.cvv}
          inputMode="numeric"
          appmax-form-element={CARD_FIELDS.cvv.element}
          name={CARD_FIELDS.cvv.name}
          className={input}
        />
      </div>
      <button
        type="submit"
        className="rounded-full bg-am-purple px-5 py-2.5 text-sm font-medium text-white hover:bg-am-purple-hover"
      >
        Pagar com cartão
      </button>
    </form>
  );
}
