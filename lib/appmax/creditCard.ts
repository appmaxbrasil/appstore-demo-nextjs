import { getMerchantAccessToken } from "./auth";
import { appmaxApiRequest } from "./http";

export type PayWithCreditCardInput = {
  orderId: number;
  customerId: number;
  /** Token gerado pelo Appmax JS no browser — nunca o número do cartão. */
  token: string;
  holderDocumentNumber: string;
  holderName: string;
  installments: number; // 1 a 12
  softDescriptor?: string; // opcional, máx. 13 caracteres
};

/**
 * Ver /api-reference/payments/cartao-credito — POST /v1/payments/credit-card.
 *
 * O token já foi gerado no browser pelo `appmax.min.js` (form
 * `data-appmax-checkout`, ver app/components/CreditCardForm.tsx). Número do
 * cartão e CVV nunca passam por este backend.
 */
export async function payWithCreditCard(input: PayWithCreditCardInput): Promise<unknown> {
  const token = await getMerchantAccessToken();

  return appmaxApiRequest("POST", "/v1/payments/credit-card", {
    token,
    body: {
      order_id: input.orderId,
      customer_id: input.customerId,
      payment_data: {
        credit_card: {
          token: input.token,
          holder_document_number: input.holderDocumentNumber,
          holder_name: input.holderName,
          installments: input.installments,
          soft_descriptor: input.softDescriptor,
        },
      },
    },
  });
}
