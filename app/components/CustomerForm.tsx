"use client";

export type CustomerData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  documentNumber: string;
  postcode: string;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
};

type Props = {
  value: CustomerData;
  onChange: <K extends keyof CustomerData>(field: K, value: string) => void;
  installments: number;
  onInstallmentsChange: (value: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled?: boolean;
};

const input =
  "rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple";

/**
 * Etapa 1 do checkout: comprador e endereço.
 *
 * Não tem nada de Appmax aqui — é um form React comum, e os valores vão para o
 * seu backend (`POST /api/checkout`), nunca para o SDK.
 */
export default function CustomerForm({
  value,
  onChange,
  installments,
  onInstallmentsChange,
  onSubmit,
  disabled,
}: Props) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <input
          required
          placeholder="Nome"
          className={input}
          value={value.firstName}
          onChange={(e) => onChange("firstName", e.target.value)}
        />
        <input
          required
          placeholder="Sobrenome"
          className={input}
          value={value.lastName}
          onChange={(e) => onChange("lastName", e.target.value)}
        />
      </div>
      <input
        required
        type="email"
        placeholder="E-mail"
        className={input}
        value={value.email}
        onChange={(e) => onChange("email", e.target.value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          required
          placeholder="Telefone (DDD+número)"
          className={input}
          value={value.phone}
          onChange={(e) => onChange("phone", e.target.value)}
        />
        <input
          required
          placeholder="CPF (titular do cartão)"
          className={input}
          value={value.documentNumber}
          onChange={(e) => onChange("documentNumber", e.target.value)}
        />
      </div>

      <details className="text-sm text-am-ink-muted">
        <summary className="cursor-pointer select-none">Endereço (opcional)</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <input
            placeholder="CEP"
            className={input}
            value={value.postcode}
            onChange={(e) => onChange("postcode", e.target.value)}
          />
          <input
            placeholder="Número"
            className={input}
            value={value.number}
            onChange={(e) => onChange("number", e.target.value)}
          />
          <input
            placeholder="Rua"
            className={`col-span-2 ${input}`}
            value={value.street}
            onChange={(e) => onChange("street", e.target.value)}
          />
          <input
            placeholder="Bairro"
            className={input}
            value={value.district}
            onChange={(e) => onChange("district", e.target.value)}
          />
          <input
            placeholder="Cidade"
            className={input}
            value={value.city}
            onChange={(e) => onChange("city", e.target.value)}
          />
          <input
            placeholder="UF"
            className={input}
            value={value.state}
            onChange={(e) => onChange("state", e.target.value)}
          />
        </div>
      </details>

      <label className="flex items-center gap-2 text-sm">
        Parcelas
        <select
          className="rounded border border-am-border bg-white px-2 py-1 text-am-ink"
          value={installments}
          onChange={(e) => onInstallmentsChange(Number(e.target.value))}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}x
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={disabled}
        className="mt-2 rounded-full bg-am-purple px-5 py-2.5 text-sm font-medium text-white hover:bg-am-purple-hover disabled:opacity-40"
      >
        Continuar para pagamento
      </button>
    </form>
  );
}
