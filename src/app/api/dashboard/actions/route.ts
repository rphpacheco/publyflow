import { NextResponse } from "next/server";
import { db } from "@/db";
import { getSession } from "@/lib/auth/session";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";
import { DashboardActionsService } from "@/services/dashboard-actions.service";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  try {
    const actions = await DashboardActionsService.get(db, session.organizationId, { creatorScope: null });
    return NextResponse.json(actions, { status: 200 });
  } catch (error) {
    if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
    throw error;
  }
}
