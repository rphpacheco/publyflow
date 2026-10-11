import { NextResponse } from "next/server";
import { db } from "@/db";
import { getRouteSession, forbiddenResponse } from "@/lib/auth/http";
import { TeamService } from "@/services/team.service";

export async function GET() {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;
  if (session.role === "CREATOR") return forbiddenResponse();
  return NextResponse.json(await TeamService.list(db, session), { status: 200 });
}
