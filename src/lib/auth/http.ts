import { NextResponse } from "next/server";

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
