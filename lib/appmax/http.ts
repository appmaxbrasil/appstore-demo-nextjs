import { NextResponse } from "next/server";
import { getAppmaxBaseUrls } from "./config";

/** Erro de API da Appmax, com o status HTTP e o corpo bruto de resposta anexados. */
export class AppmaxApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "AppmaxApiError";
    this.status = status;
    this.body = body;
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;

    // Formato OAuth2 (RFC 6749 §5.2): `{ error: "invalid_client",
    // error_description: "..." }`, com `error` como STRING. Sem este caso, um
    // 401 de credencial errada viraria só "Falha ao autenticar (HTTP 401)",
    // escondendo o motivo real.
    if (typeof obj.error === "string") {
      const description = typeof obj.error_description === "string" ? obj.error_description : null;
      return description ? `${obj.error}: ${description}` : obj.error;
    }

    const error = obj.error as Record<string, unknown> | undefined;
    if (error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

/**
 * POST application/x-www-form-urlencoded contra `auth.*appmax.com.br`.
 * Usado só para obter tokens OAuth2 (client_credentials) — app ou merchant.
 */
export async function appmaxAuthRequest(
  path: string,
  form: Record<string, string>
): Promise<unknown> {
  const { authUrl } = getAppmaxBaseUrls();
  const res = await fetch(`${authUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
  });
  const body = await parseBody(res);
  if (!res.ok) {
    throw new AppmaxApiError(
      extractErrorMessage(body, `Falha ao autenticar (HTTP ${res.status})`),
      res.status,
      body
    );
  }
  return body;
}

/**
 * Requisição contra `api.*appmax.com.br`, com Bearer token e o envelope
 * `{ data: ... }` já desembrulhado.
 */
export async function appmaxApiRequest<T = unknown>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: { token: string; body?: unknown }
): Promise<T> {
  const { apiUrl } = getAppmaxBaseUrls();
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const body = await parseBody(res);
  if (!res.ok) {
    throw new AppmaxApiError(
      extractErrorMessage(body, `Requisição Appmax falhou (HTTP ${res.status})`),
      res.status,
      body
    );
  }
  if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>).data as T;
  }
  return body as T;
}

/**
 * Traduz um erro das rotas de checkout para a resposta HTTP. Repassa o status
 * da Appmax quando ele é utilizável (assim um 402 de cartão recusado não vira
 * 500) e o corpo original em `detail`, que é onde está o motivo da recusa.
 */
export function appmaxErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppmaxApiError) {
    return NextResponse.json(
      { error: error.message, detail: error.body },
      { status: error.status >= 400 && error.status < 600 ? error.status : 502 }
    );
  }
  const message = error instanceof Error ? error.message : "Erro desconhecido";
  return NextResponse.json({ error: message }, { status: 500 });
}
