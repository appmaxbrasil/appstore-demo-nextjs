import { getMerchantAccessToken } from "./auth";
import { appmaxApiRequest } from "./http";
import type { GooglePaymentMethodData } from "./scripts";

export type { GooglePaymentMethodData };

export type PayGooglePayInput = {
  orderId: number;
  customerId: number;
  installments: number; // 1 a 12 — teto FIXO, diferente do cartão
  holderDocumentNumber: string;
  softDescriptor?: string; // opcional, máx. 13 caracteres
  paymentMethodData: GooglePaymentMethodData;
};

/**
 * Ver /api-reference/payments/google-pay — POST /v1/payments/google-pay.
 *
 * O `paymentMethodData` vai INTEIRO e sem alteração em
 * `payment_data.google_pay.payment_data`: nada de `JSON.parse` no
 * `tokenizationData.token` (a Appmax faz o parse) e nada de remover `info`
 * (a Appmax usa bandeira e últimos dígitos no comprovante). Mexer no objeto é
 * a causa quase certa de `400 Invalid Google Pay token`.
 *
 * Não há campo de valor: a cobrança é sempre o total do pedido. O `total` do
 * `onUpdate` só controla o que aparece na folha do Google.
 */
export async function payWithGooglePay(input: PayGooglePayInput): Promise<unknown> {
  const token = await getMerchantAccessToken();

  return appmaxApiRequest("POST", "/v1/payments/google-pay", {
    token,
    body: {
      order_id: input.orderId,
      customer_id: input.customerId,
      payment_data: {
        google_pay: {
          installments: input.installments,
          holder_document_number: input.holderDocumentNumber,
          soft_descriptor: input.softDescriptor,
          payment_data: input.paymentMethodData,
        },
      },
    },
  });
}
