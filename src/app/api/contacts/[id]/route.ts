import { NextResponse } from "next/server";
import { db } from "@/db";
import { ContactService } from "@/services/contact.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const contact = await ContactService.findById(db, session.organizationId, id);
  if (!contact) {
    return NextResponse.json({ error: `Contact ${id} not found` }, { status: 404 });
  }
  return NextResponse.json(contact, { status: 200 });
}
