"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TEST_PRODUCT, formatBRL } from "@/lib/checkout/product";
import { TEST_CARD, TEST_CUSTOMER } from "@/lib/checkout/testData";
import type { AppleToken, AppmaxCheckoutData, AppmaxError } from "@/lib/appmax/scripts";
import { useAppmaxScripts } from "./components/useAppmaxScripts";
import AppmaxIpForm from "./components/AppmaxIpForm";
import CustomerForm, { type CustomerData } from "./components/CustomerForm";
import CreditCardForm from "./components/CreditCardForm";
import ApplePayButton from "./components/ApplePayButton";
import ExternalIdOverride, { useExternalIdOverride } from "./components/ExternalIdOverride";

/**
 * Checkout de exemplo — a ORQUESTRAÇÃO do fluxo.
 *
 * O SDK só conversa com `useAppmaxScripts`; o resto é React comum. Cada peça da
 * integração mora num arquivo:
 *
 *   lib/appmax/scripts.ts      contrato do SDK (tipos, seletores, campos)
 *   useAppmaxScripts.ts        carrega o appmax.min.js e devolve o IP
 *   AppmaxIpForm.tsx           gatilho da coleta de IP
 *   CreditCardForm.tsx         form que o SDK tokeniza
 *   ApplePayButton.tsx         container do botão gerenciado pelo SDK
 *   este arquivo               estado, chamadas ao backend, composição
 */

type PublicConfig = {
  environment: "sandbox" | "production";
  scriptUrl: string;
  scriptApi: "legacy" | "structured";
  externalId: string | null;
  merchantConfigured: boolean;
  product: typeof TEST_PRODUCT;
};

type Step = "form" | "ready" | "processing" | "success" | "error";

export default function CheckoutPage() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [form, setForm] = useState<CustomerData>(TEST_CUSTOMER);
  const [installments, setInstallments] = useState(1);
  const [step, setStep] = useState<Step>("form");
  const [message, setMessage] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [cardHolderName, setCardHolderName] = useState(TEST_CARD.holderName);
  const [externalIdOverride, applyExternalIdOverride] = useExternalIdOverride();

  /**
   * Pedido que já teve pagamento de cartão disparado — trava de idempotência.
   *
   * O caminho normal entrega um token por clique. A trava existe porque a
   * consequência de um token extra chegar (duplo submit do form, um clique
   * duplo do comprador, um `init()` repetido) é uma cobrança dupla com dinheiro
   * real — e a de-duplicação por token não serve, já que cada tokenização
   * devolve um token diferente. Por isso a chave é o pedido.
   *
   * Ver FLUXO-CARTAO.md §3.
   */
  const cardPaymentLockRef = useRef<number | null>(null);

  const effectiveExternalId = externalIdOverride.trim() || config?.externalId || null;
  const missingExternalId = Boolean(config) && !effectiveExternalId;

  // Espelho do estado para os callbacks do SDK, que são registrados uma vez e
  // fechariam sobre valores velhos se lessem o state direto.
  const latest = useRef({ orderId, customerId, installments, form, cardHolderName });
  useEffect(() => {
    latest.current = { orderId, customerId, installments, form, cardHolderName };
  }, [orderId, customerId, installments, form, cardHolderName]);

  useEffect(() => {
    fetch("/api/appmax/public-config")
      .then((res) => res.json())
      .then((next: PublicConfig) => {
        console.log(
          `[Appmax] config: ${next.environment} · external_id do banco: ${next.externalId ?? "(vazio)"}`
        );
        setConfig(next);
      })
      .catch(() => setMessage("Não foi possível carregar a configuração do servidor."));
  }, []);

  const totalCents = TEST_PRODUCT.unitValueCents * TEST_PRODUCT.quantity;

  /** `onUpdate` do SDK: monta os itens/total da PaymentSheet do Apple Pay. */
  const getCheckoutData = useCallback((): AppmaxCheckoutData => {
    const { orderId, installments } = latest.current;
    return {
      orderId: orderId ? String(orderId) : "",
      total: totalCents / 100,
      freight: 0,
      discount: 0,
      installments,
      products: [
        {
          name: TEST_PRODUCT.name,
          price: TEST_PRODUCT.unitValueCents / 100,
          quantity: TEST_PRODUCT.quantity,
        },
      ],
    };
  }, [totalCents]);

  /** Devolve true/false para o `onAuthorize` decidir resolver ou lançar. */
  const submitApplePayment = useCallback(async (appleToken: AppleToken): Promise<boolean> => {
    const { orderId, customerId, installments, form } = latest.current;
    if (!orderId || !customerId) {
      setMessage("Finalize os dados do pedido antes de pagar.");
      return false;
    }
    setStep("processing");
    setMessage(null);
    try {
      const res = await fetch("/api/checkout/apple-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          customerId,
          installments,
          holderDocumentNumber: form.documentNumber,
          appleToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Falha no pagamento (HTTP ${res.status})`);
      setStep("success");
      setMessage("Pagamento aprovado! ✅");
      return true;
    } catch (error) {
      console.error("[Appmax] apple-pay: falha ao efetivar o pagamento", error);
      setStep("error");
      setMessage(error instanceof Error ? error.message : "Erro ao processar pagamento.");
      return false;
    }
  }, []);

  /** Mesmo shape do Apple Pay, só troca o endpoint. */
  const submitCreditCardPayment = useCallback(async (token: string) => {
    const { orderId, customerId, installments, form, cardHolderName } = latest.current;
    if (!orderId || !customerId) {
      setMessage("Finalize os dados do pedido antes de pagar.");
      return;
    }
    setStep("processing");
    setMessage(null);
    try {
      const res = await fetch("/api/checkout/credit-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          customerId,
          token,
          installments,
          holderDocumentNumber: form.documentNumber,
          holderName: cardHolderName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Falha no pagamento (HTTP ${res.status})`);
      setStep("success");
      setMessage("Pagamento aprovado! ✅");
    } catch (error) {
      console.error("[Appmax] cartão: falha ao efetivar o pagamento", error);
      // Libera a trava: o pagamento não aconteceu, o retry precisa passar.
      cardPaymentLockRef.current = null;
      setStep("error");
      setMessage(error instanceof Error ? error.message : "Erro ao processar pagamento.");
    }
  }, []);

  /**
   * A trava é posta de forma SÍNCRONA, antes de qualquer await: um segundo
   * token pode chegar logo atrás do primeiro e precisa encontrar o lock já
   * posto. É por isso que é um `useRef`, e não `useState`.
   */
  const onCardToken = useCallback(
    (token: string) => {
      const { orderId } = latest.current;
      if (cardPaymentLockRef.current === orderId) {
        console.warn(
          `[Appmax] segundo token de cartão para o pedido ${orderId} — ignorando para não cobrar duas vezes.`
        );
        return;
      }
      cardPaymentLockRef.current = orderId;
      console.log("[Appmax] token de cartão recebido");
      submitCreditCardPayment(token);
    },
    [submitCreditCardPayment]
  );

  /**
   * O SDK decide sucesso/falha pelo resolve/reject da Promise, NÃO pelo valor
   * retornado. Devolver `false` sem lançar faz ele chamar
   * `completePayment(STATUS_SUCCESS)` num pagamento que falhou — o cliente vê
   * "aprovado" no Safari sem ter pago.
   */
  const onAuthorize = useCallback(
    async (appleToken: AppleToken) => {
      const ok = await submitApplePayment(appleToken);
      if (!ok) throw new Error("Pagamento não aprovado");
    },
    [submitApplePayment]
  );

  const onAppmaxError = useCallback((err: unknown) => {
    console.error("[Appmax] onError do AppmaxScripts:", err);

    // Com o init por objeto de opções o erro traz code/stage e, quando a falha
    // veio da API, o status HTTP. Na forma posicional chega uma string, e aí
    // cai no texto genérico abaixo.
    const detail = err as Partial<AppmaxError> | null;
    if (detail?.code) {
      setMessage(
        `Erro no Appmax JS: ${detail.code}${
          detail.stage ? ` (${detail.stage})` : ""
        }${detail.status ? ` — HTTP ${detail.status}` : ""}. Veja o console.`
      );
      return;
    }
    setMessage("Erro no Appmax JS (veja o console).");
  }, []);

  const { ip } = useAppmaxScripts({
    scriptUrl: config?.scriptUrl ?? null,
    externalId: effectiveExternalId,
    environment: config?.environment,
    scriptApi: config?.scriptApi,
    onCardToken,
    onError: onAppmaxError,
    getCheckoutData,
    onAuthorize,
  });

  function updateField<K extends keyof CustomerData>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!ip) {
      setMessage(
        "Aguardando a coleta de IP do Appmax JS — ela acontece no carregamento da página. Tente de novo em um instante."
      );
      return;
    }
    setMessage(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          documentNumber: form.documentNumber || undefined,
          address: form.postcode
            ? {
                postcode: form.postcode,
                street: form.street,
                number: form.number,
                district: form.district,
                city: form.city,
                state: form.state,
              }
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Falha ao criar pedido (HTTP ${res.status})`);
      setOrderId(data.orderId);
      setCustomerId(data.customerId);
      setStep("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao criar pedido.");
    }
  }

  /**
   * Volta ao início sem reload de propósito: o `init()` roda uma vez por carga
   * de página e o IP só é coletado nele.
   */
  function startNewOrder() {
    setOrderId(null);
    setCustomerId(null);
    setMessage(null);
    cardPaymentLockRef.current = null;
    setStep("form");
  }

  // Depois de um erro o pagamento continua visível, senão não haveria retry.
  const paymentsVisible = orderId !== null && step !== "success";

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Checkout de teste — Appmax JS</h1>
        <p className="text-sm text-am-ink-muted">
          Demo de tokenização de cartão e Apple Pay com o Appmax JS
          ({config?.environment ?? "…"}).
        </p>
      </header>

      {/* Gatilho da coleta de IP: precisa estar no DOM antes do init() do SDK. */}
      <AppmaxIpForm />

      {missingExternalId && (
        <div className="rounded-lg border border-am-danger-text/30 bg-am-danger-bg p-4 text-sm text-am-danger-text">
          <strong>external_id não configurado ({config?.environment}).</strong>{" "}
          O <code>appmax.min.js</code> não foi nem carregado — sem esse id toda
          chamada do SDK volta{" "}
          <code>404 &quot;Merchant not found&quot;</code> (o erro genérico
          &quot;Failed to tokenize card.&quot; no cartão). Conclua a instalação em{" "}
          <Link href="/setup" className="underline">
            /setup
          </Link>{" "}
          ou salve o valor em{" "}
          <Link href="/configuracao" className="underline">
            /configuracao
          </Link>
          .
        </div>
      )}

      {config && !config.merchantConfigured && (
        <div className="rounded-lg border border-am-warn-text/30 bg-am-warn-bg p-4 text-sm text-am-warn-text">
          Integração ainda não instalada.{" "}
          <Link href="/setup" className="underline">
            Vá para /setup
          </Link>{" "}
          para concluir o fluxo de instalação com a Appmax.
        </div>
      )}

      <ExternalIdOverride
        externalIdFromDb={config?.externalId ?? null}
        value={externalIdOverride}
        onApply={applyExternalIdOverride}
      />

      <section className="rounded-lg border border-am-border bg-am-card p-5 text-sm">
        <div className="flex justify-between">
          <span>{TEST_PRODUCT.name}</span>
          <span>{formatBRL(TEST_PRODUCT.unitValueCents)}</span>
        </div>
        <div className="mt-2 flex justify-between font-medium">
          <span>Total</span>
          <span>{formatBRL(totalCents)}</span>
        </div>
      </section>

      {step === "form" && (
        <CustomerForm
          value={form}
          onChange={updateField}
          installments={installments}
          onInstallmentsChange={setInstallments}
          onSubmit={handleContinue}
          disabled={!config?.merchantConfigured || missingExternalId}
        />
      )}

      {step === "ready" && (
        <p className="text-sm text-am-ink-muted">
          Pedido #{orderId} criado. Pague com cartão abaixo, ou toque no botão do
          Apple Pay.
        </p>
      )}

      <ApplePayButton visible={paymentsVisible} />

      <CreditCardForm
        visible={paymentsVisible}
        holderName={cardHolderName}
        onHolderNameChange={setCardHolderName}
        onSubmit={() => setMessage(null)}
      />

      {step === "processing" && <p className="text-sm">Processando pagamento…</p>}

      {step === "success" && <p className="text-sm text-am-success-text">{message}</p>}

      {message && step !== "success" && (
        <p className="text-sm text-am-danger-text">{message}</p>
      )}

      {step !== "form" && (
        <button
          type="button"
          onClick={startNewOrder}
          disabled={step === "processing"}
          className="w-fit rounded-full border border-am-border px-5 py-2.5 text-sm font-medium text-am-ink hover:bg-am-purple-hover/10 disabled:opacity-40"
        >
          Fazer novo pedido
        </button>
      )}
    </div>
  );
}
