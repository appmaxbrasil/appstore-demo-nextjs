import { NextRequest, NextResponse } from "next/server";
import { payWithApplePay, type AppleToken } from "@/lib/appmax/applePay";
import { appmaxErrorResponse } from "@/lib/appmax/http";

type ApplePayBody = {
  orderId: number;
  customerId: number;
  holderDocumentNumber: string;
  installments?: number;
  softDescriptor?: string;
  appleToken: AppleToken;
};

/**
 * Recebe o `appleToken` devolvido pelo callback `onAuthorize` do Appmax JS e
 * efetiva o pagamento em POST /v1/payments/apple-pay
 * (/api-reference/payments/apple-pay).
 */
export async function POST(request: NextRequest) {
  let body: ApplePayBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.orderId || !body.customerId || !body.holderDocumentNumber || !body.appleToken) {
    return NextResponse.json(
      {
        error:
          "Campos obrigatórios: orderId, customerId, holderDocumentNumber, appleToken",
      },
      { status: 400 }
    );
  }

  try {
    const result = await payWithApplePay({
      orderId: body.orderId,
      customerId: body.customerId,
      installments: body.installments ?? 1,
      holderDocumentNumber: body.holderDocumentNumber,
      softDescriptor: body.softDescriptor,
      appleToken: body.appleToken,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return appmaxErrorResponse(error);
  }
}
