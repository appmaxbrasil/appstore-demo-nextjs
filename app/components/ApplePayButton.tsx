"use client";

import { useSyncExternalStore } from "react";

// Fora do componente: identidade estável, senão o useSyncExternalStore
// re-assina a cada render.
function subscribe() {
  return () => {};
}
function getSnapshot() {
  if (typeof window === "undefined" || !window.ApplePaySession) return false;
  try {
    return window.ApplePaySession.canMakePayments();
  } catch {
    return false;
  }
}
function getServerSnapshot() {
  return false;
}

/**
 * `canMakePayments()` só existe no browser, então o SSR precisa de um valor
 * estável (`false`) que se atualiza no client sem warning de hidratação.
 */
export function useApplePayAvailable() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Botão do Apple Pay — fluxo GERENCIADO pelo SDK.
 *
 * A gente não renderiza botão nenhum: o `appmax.min.js` troca o `innerHTML`
 * deste container por um `<button data-appmax-apple-pay>` oficial da Apple e
 * registra o clique sozinho. Ele também cuida da PaymentSheet e da validação
 * de merchant session.
 *
 * O container precisa existir no DOM ANTES do `init()` — o SDK procura por ele
 * uma única vez. Por isso ele fica sempre montado e só escondido via CSS.
 */
export default function ApplePayButton({ visible }: { visible: boolean }) {
  const available = useApplePayAvailable();

  return (
    <>
      {!available && (
        <div className="rounded-lg border border-am-border bg-am-purple-soft p-4 text-sm text-am-ink">
          Apple Pay não está disponível neste navegador. Ele só aparece no Safari
          (macOS/iOS) com um cartão configurado na Apple Wallet, e a página precisa
          estar servida via HTTPS pública (não funciona em <code>localhost</code>).
        </div>
      )}
      <div className={`appmax-apple-pay-btn h-12 ${visible ? "" : "hidden"}`} />
    </>
  );
}
