import type { NextResponse } from "next/server";
import { forbiddenResponse } from "./http";
import type { Session, SessionRole } from "./types";

/** OWNER/MANAGER: null (no restriction). CREATOR: its own creator id. */
export function creatorScope(session: Session): string | null {
  return session.role === "CREATOR" ? session.creatorId : null;
}

export function isCreator(session: Session): boolean {
  return session.role === "CREATOR";
}

/** Writes are denied to CREATOR by default; allowed exceptions simply don't call this. */
export function denyCreatorWrite(session: Session): NextResponse | null {
  return isCreator(session) ? forbiddenResponse() : null;
}

/** Agency-side management (creators, CRM). */
export function canManageOrganization(role: SessionRole): boolean {
  return role === "OWNER" || role === "MANAGER";
}
