import { NextRequest, NextResponse } from "next/server";
import { upsertCustomer } from "@/lib/appmax/customers";
import { createOrder } from "@/lib/appmax/orders";
import { appmaxErrorResponse } from "@/lib/appmax/http";
import { TEST_PRODUCT } from "@/lib/checkout/product";

type CheckoutBody = {
  ip: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  documentNumber?: string;
  address?: {
    postcode?: string;
    street?: string;
    number?: string;
    complement?: string;
    district?: string;
    city?: string;
    state?: string;
  };
};

/**
 * Cria customer + order na Appmax, nessa ordem — a order precisa de um
 * `customer_id` existente. Devolve os dois ids, que o front guarda até ter o
 * token do cartão (ou o Apple Token) para efetivar o pagamento.
 *
 * Todas as chamadas à Appmax acontecem no servidor: o browser nunca vê
 * client_id/client_secret nem o access_token do merchant.
 */
export async function POST(request: NextRequest) {
  let body: CheckoutBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.ip || !body.firstName || !body.lastName || !body.email || !body.phone) {
    return NextResponse.json(
      { error: "Campos obrigatórios: ip, firstName, lastName, email, phone" },
      { status: 400 }
    );
  }

  try {
    const customer = await upsertCustomer({
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      ip: body.ip,
      documentNumber: body.documentNumber,
      address: body.address,
    });

    const order = await createOrder(customer.id);

    return NextResponse.json({
      customerId: customer.id,
      orderId: order.id,
      status: order.status,
      amountCents: TEST_PRODUCT.unitValueCents * TEST_PRODUCT.quantity,
    });
  } catch (error) {
    return appmaxErrorResponse(error);
  }
}
