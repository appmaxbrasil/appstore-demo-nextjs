import { NextResponse } from "next/server";
import { getExternalId, getMerchantCredentials } from "@/lib/appmax/state";
import { getAppmaxEnvironment, getAppBaseUrl, getValidateUrl } from "@/lib/appmax/config";

function mask(value?: string): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export async function GET() {
  // Os mesmos getters que o resto do app usa — ler `state.json` direto aqui
  // faria este JSON divergir do que a página /setup mostra.
  const externalId = getExternalId();
  const merchant = getMerchantCredentials();

  let appBaseUrl: string | null = null;
  let validateUrl: string | null = null;
  let baseUrlError: string | null = null;
  try {
    appBaseUrl = await getAppBaseUrl();
    validateUrl = await getValidateUrl();
  } catch (error) {
    baseUrlError = error instanceof Error ? error.message : "APP_BASE_URL ausente";
  }

  return NextResponse.json({
    environment: getAppmaxEnvironment(),
    appBaseUrl,
    validateUrl,
    baseUrlError,
    externalId,
    merchantConfigured: Boolean(merchant),
    merchantClientId: mask(merchant?.clientId),
  });
}
