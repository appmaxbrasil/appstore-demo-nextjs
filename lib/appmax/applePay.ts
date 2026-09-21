import { getMerchantAccessToken } from "./auth";
import { appmaxApiRequest } from "./http";
import type { AppleToken } from "./scripts";

export type { AppleToken };

export type PayApplePayInput = {
  orderId: number;
  customerId: number;
  installments: number; // 1 a 12
  holderDocumentNumber: string;
  softDescriptor?: string; // opcional, máx. 13 caracteres
  appleToken: AppleToken;
};

/**
 * A merchant session NÃO passa por aqui — e nem precisa passar pelo seu
 * backend. Quem a obtém é o próprio `appmax.min.js`, no browser, quando a
 * PaymentSheet abre: a chamada não envolve nenhum segredo seu, só o
 * `external_id` da instalação. Ver FLUXO-APPLE-PAY.md §5 e
 * /api-reference/payments/apple-pay-appmax-js.
 *
 * O endpoint `POST /v1/apple-pay/merchant-session` documentado existe para o
 * caso avançado de reimplementar a `ApplePaySession` na mão, sem o script.
 */

/** Ver /api-reference/payments/apple-pay — POST /v1/payments/apple-pay. */
export async function payWithApplePay(input: PayApplePayInput): Promise<unknown> {
  const token = await getMerchantAccessToken();

  return appmaxApiRequest("POST", "/v1/payments/apple-pay", {
    token,
    body: {
      order_id: input.orderId,
      customer_id: input.customerId,
      payment_data: {
        apple_pay: {
          installments: String(input.installments),
          holder_document_number: input.holderDocumentNumber,
          soft_descriptor: input.softDescriptor,
          payment_data: input.appleToken.paymentData,
          payment_method: input.appleToken.paymentMethod,
          transaction_identifier: input.appleToken.transactionIdentifier,
        },
      },
    },
  });
}
