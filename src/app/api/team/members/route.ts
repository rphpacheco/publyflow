import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { getRouteSession, forbiddenResponse } from "@/lib/auth/http";
import { canManageTeam } from "@/lib/auth/access";
import { inviteManagerSchema } from "@/lib/team/team-input";
import { TeamService } from "@/services/team.service";
import { teamErrorResponse } from "../team-errors";

export async function POST(request: Request) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;
  if (!canManageTeam(session.role)) return forbiddenResponse();
  const parsed = inviteManagerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  try {
    const result = await TeamService.inviteManager(db, session, parsed.data, new URL(request.url).origin);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const mapped = teamErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
