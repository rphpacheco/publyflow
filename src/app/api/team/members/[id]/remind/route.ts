import { NextResponse } from "next/server";
import { db } from "@/db";
import { getRouteSession, forbiddenResponse } from "@/lib/auth/http";
import { canManageTeam } from "@/lib/auth/access";
import { isUuid } from "@/lib/uuid";
import { TeamService } from "@/services/team.service";
import { teamErrorResponse, teamNotFoundResponse } from "../../../team-errors";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  if (!isUuid(id)) return teamNotFoundResponse();
  if (!canManageTeam(session.role)) return forbiddenResponse();
  try {
    const result = await TeamService.remind(db, session, id, new URL(request.url).origin);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const mapped = teamErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
