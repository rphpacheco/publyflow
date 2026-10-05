import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { getSession } from "@/lib/auth/session";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";
import { periodQuerySchema } from "@/lib/dashboard/period";
import { DashboardService } from "@/services/dashboard.service";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const params = new URL(request.url).searchParams;
  const parsed = periodQuerySchema.safeParse({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    // The dashboard is agency-only today; the scope parameter exists for a future creator view (spec D2).
    const metrics = await DashboardService.getMetrics(db, session.organizationId, parsed.data, { creatorScope: null });
    return NextResponse.json(metrics, { status: 200 });
  } catch (error) {
    if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
    throw error;
  }
}
