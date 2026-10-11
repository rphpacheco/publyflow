import { NextResponse } from "next/server";
import { TeamConflictError, TeamMemberNotFoundError } from "@/domain/team/errors";
import { AuthProvisioningError } from "@/lib/auth/errors";
import { authProvisioningFailedResponse } from "@/lib/auth/http";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

export function teamNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: "Membro não encontrado." }, { status: 404 });
}

export function teamErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof TeamMemberNotFoundError) return teamNotFoundResponse();
  if (error instanceof TeamConflictError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
  if (error instanceof AuthProvisioningError) return authProvisioningFailedResponse();
  if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
  return null;
}
