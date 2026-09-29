import { NextResponse } from "next/server";
import type { SessionRole } from "./types";

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
}

export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
}

/** Creators are managed by the agency side only. */
export function canManageCreators(role: SessionRole): boolean {
  return role === "OWNER" || role === "MANAGER";
}
