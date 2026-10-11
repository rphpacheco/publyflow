import { NextResponse } from "next/server";
import { getSession } from "./session";
import { AuthUnavailableError } from "./errors";
import type { Session } from "./types";

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
}

export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
}

export function authProvisioningFailedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Não foi possível liberar o acesso agora. Tente novamente.", code: "AUTH_PROVISIONING_FAILED" },
    { status: 502 },
  );
}

export function authUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "Serviço de autenticação indisponível. Tente novamente em instantes.", code: "AUTH_UNAVAILABLE" },
    { status: 503 },
  );
}

// The only way API routes read the session (enforced by
// src/app/api/route-session-guard.test.ts): 401 without a session, 503 when
// the auth provider is unavailable.
export async function getRouteSession(): Promise<Session | NextResponse> {
  try {
    return (await getSession()) ?? unauthorizedResponse();
  } catch (error) {
    if (error instanceof AuthUnavailableError) return authUnavailableResponse();
    throw error;
  }
}
