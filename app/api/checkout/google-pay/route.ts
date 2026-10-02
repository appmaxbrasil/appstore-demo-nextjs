import { NextRequest, NextResponse } from "next/server";
import { payWithGooglePay, type GooglePaymentMethodData } from "@/lib/appmax/googlePay";
import { appmaxErrorResponse } from "@/lib/appmax/http";

type GooglePayBody = {
  orderId: number;
  customerId: number;
  holderDocumentNumber: string;
  installments?: number;
  softDescriptor?: string;
  paymentMethodData: GooglePaymentMethodData;
};

/**
 * Recebe o `paymentMethodData` devolvido pelo `onAuthorize` do Appmax JS e
 * efetiva o pagamento em POST /v1/payments/google-pay
 * (/api-reference/payments/google-pay). O objeto é repassado sem alteração.
 */
export async function POST(request: NextRequest) {
  let body: GooglePayBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (
    !body.orderId ||
    !body.customerId ||
    !body.holderDocumentNumber ||
    typeof body.paymentMethodData?.tokenizationData?.token !== "string" ||
    !body.paymentMethodData.info?.cardNetwork
  ) {
    return NextResponse.json(
      {
        error:
          "Campos obrigatórios: orderId, customerId, holderDocumentNumber, paymentMethodData (com tokenizationData.token e info.cardNetwork)",
      },
      { status: 400 }
    );
  }

  // No Google Pay o teto de parcelas é fixo em 12, mesmo que a loja tenha
  // parcelamento estendido no cartão.
  const installments = body.installments ?? 1;
  if (!Number.isInteger(installments) || installments < 1 || installments > 12) {
    return NextResponse.json(
      { error: "installments deve ser um inteiro de 1 a 12 no Google Pay" },
      { status: 400 }
    );
  }

  try {
    const result = await payWithGooglePay({
      orderId: body.orderId,
      customerId: body.customerId,
      installments,
      holderDocumentNumber: body.holderDocumentNumber,
      softDescriptor: body.softDescriptor,
      paymentMethodData: body.paymentMethodData,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return appmaxErrorResponse(error);
  }
}
