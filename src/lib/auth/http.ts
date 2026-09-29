import { NextResponse } from "next/server";

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
}

export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
}
