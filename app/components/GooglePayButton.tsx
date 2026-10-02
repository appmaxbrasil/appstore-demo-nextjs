/**
 * Botão do Google Pay — fluxo GERENCIADO pelo SDK, via iframe da Appmax.
 *
 * O `appmax.min.js` procura `[data-appmax-google-pay]` UMA vez, no `init()`,
 * insere o iframe da Appmax logo antes dele (com a altura dele, mínimo 48px) e
 * esconde o placeholder. O iframe carrega o `pay.js` do Google, abre a folha e
 * devolve o `PaymentMethodData` no `onAuthorize`.
 *
 * O iframe nasce DENTRO do wrapper, então é o wrapper que controla a
 * visibilidade — esconder só o placeholder não esconderia o botão. Nada de
 * `display:none` no placeholder: a altura seria lida como 0.
 *
 * O SDK só monta o Google Pay quando o Apple Pay NÃO está disponível (Safari
 * com Wallet), e nesse caso ele mesmo esconde o wrapper.
 */
export default function GooglePayButton({ visible }: { visible: boolean }) {
  return (
    <div data-appmax-google-pay-wrapper className={visible ? "" : "hidden"}>
      <div data-appmax-google-pay className="h-12" />
    </div>
  );
}
