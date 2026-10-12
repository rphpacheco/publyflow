import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  RESET_GRANT_COOKIE,
  createResetGrant,
  resetGrantCookieOptions,
} from "@/lib/auth/password-reset-grant";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";

type MemberSession = { userId: string; organizationId: string };

/** Login tracking must never block the login itself. */
export async function recordLoginSafely(session: MemberSession): Promise<void> {
  try {
    await OrganizationMembersRepository.recordLogin(db, session.organizationId, session.userId, new Date());
  } catch (e) {
    console.error("recordLogin failed", (e as { code?: string })?.code ?? "unknown");
  }
}

/** Redirects to /reset-password carrying the signed reset grant for this member. */
export function redirectToResetWithGrant(origin: string, userId: string): NextResponse {
  const response = NextResponse.redirect(new URL("/reset-password", origin));
  try {
    response.cookies.set(RESET_GRANT_COOKIE, createResetGrant(userId), resetGrantCookieOptions());
  } catch (e) {
    // Without the key no grant is possible; the reset page shows "expired".
    console.error("reset grant unavailable", (e as Error).message);
  }
  return response;
}
