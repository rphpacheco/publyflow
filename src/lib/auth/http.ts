import { NextResponse } from "next/server";

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
}
