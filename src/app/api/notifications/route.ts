import { NextResponse } from "next/server";
import { db } from "@/db";
import { NotificationsRepository } from "@/repositories/notifications.repository";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function GET(_request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const result = await NotificationsRepository.listForUser(db, session.organizationId, session.userId, 20);
  return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}
