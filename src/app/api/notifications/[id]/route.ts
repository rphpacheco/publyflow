import { NextResponse } from "next/server";
import { db } from "@/db";
import { NotificationsRepository } from "@/repositories/notifications.repository";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Notificação não encontrada." }, { status: 404 });
  const updated = await NotificationsRepository.markRead(db, session.organizationId, session.userId, id, new Date());
  if (!updated) return NextResponse.json({ error: "Notificação não encontrada." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
