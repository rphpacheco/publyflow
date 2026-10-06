import { NextResponse } from "next/server";
import { db } from "@/db";
import { NotificationsRepository } from "@/repositories/notifications.repository";
import { getRouteSession } from "@/lib/auth/http";

export async function GET(_request: Request) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;
  const result = await NotificationsRepository.listForUser(db, session.organizationId, session.userId, 20);
  return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}
