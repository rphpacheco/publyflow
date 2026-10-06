import { NextResponse } from "next/server";
import { db } from "@/db";
import { NotificationsRepository } from "@/repositories/notifications.repository";
import { getRouteSession } from "@/lib/auth/http";

export async function POST(_request: Request) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;
  const updated = await NotificationsRepository.markAllRead(db, session.organizationId, session.userId, new Date());
  return NextResponse.json({ updated }, { status: 200 });
}
