import { NextRequest, NextResponse } from "next/server";
import { payWithCreditCard } from "@/lib/appmax/creditCard";
import { appmaxErrorResponse } from "@/lib/appmax/http";

type CreditCardBody = {
  orderId: number;
  customerId: number;
  token: string;
  holderDocumentNumber: string;
  holderName: string;
  installments?: number;
  softDescriptor?: string;
};

/**
 * Último passo do fluxo de cartão: recebe o `token` que o Appmax JS gerou no
 * browser e efetiva o pagamento em POST /v1/payments/credit-card
 * (/api-reference/payments/cartao-credito).
 *
 * Número do cartão e CVV nunca chegam aqui — só o token.
 */
export async function POST(request: NextRequest) {
  let body: CreditCardBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (
    !body.orderId ||
    !body.customerId ||
    !body.token ||
    !body.holderDocumentNumber ||
    !body.holderName
  ) {
    return NextResponse.json(
      {
        error:
          "Campos obrigatórios: orderId, customerId, token, holderDocumentNumber, holderName",
      },
      { status: 400 }
    );
  }

  try {
    const result = await payWithCreditCard({
      orderId: body.orderId,
      customerId: body.customerId,
      token: body.token,
      holderDocumentNumber: body.holderDocumentNumber,
      holderName: body.holderName,
      installments: body.installments ?? 1,
      softDescriptor: body.softDescriptor,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return appmaxErrorResponse(error);
  }
}
