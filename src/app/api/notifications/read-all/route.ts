import { NextResponse } from "next/server";
import { db } from "@/db";
import { NotificationsRepository } from "@/repositories/notifications.repository";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function POST(_request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const updated = await NotificationsRepository.markAllRead(db, session.organizationId, session.userId, new Date());
  return NextResponse.json({ updated }, { status: 200 });
}
