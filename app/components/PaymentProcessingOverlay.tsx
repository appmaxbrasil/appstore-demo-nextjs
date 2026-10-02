/**
 * Loading em tela cheia enquanto o pagamento do Google Pay é efetivado.
 *
 * No Google Pay a folha fecha ANTES do `onAuthorize` rodar (ver regra 6 em
 * useAppmaxScripts.ts): sem isto o comprador volta para a página parada, com o
 * botão ainda clicável, e não sabe se pagou. O overlay cobre a tela do fim da
 * folha até a resposta de POST /api/checkout/google-pay.
 *
 * Cobre os botões em vez de desmontá-los: o `init()` do SDK não é reativo, e
 * um container removido não volta.
 */
export default function PaymentProcessingOverlay({
  visible,
  label,
}: {
  visible: boolean;
  label: string;
}) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-am-dark/40 px-4 backdrop-blur-sm"
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-lg border border-am-border bg-am-card p-6 text-center shadow-lg">
        <span
          aria-hidden
          className="h-10 w-10 animate-spin rounded-full border-4 border-am-purple-soft border-t-am-purple"
        />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-am-ink">{label}</p>
          <p className="text-xs text-am-ink-muted">Não feche nem recarregue a página.</p>
        </div>
      </div>
    </div>
  );
}
