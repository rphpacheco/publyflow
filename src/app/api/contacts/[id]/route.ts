import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ContactService } from "@/services/contact.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const contact = await ContactService.findById(db, payload.organizationId, id);
  if (!contact) {
    return NextResponse.json({ error: `Contact ${id} not found` }, { status: 404 });
  }
  return NextResponse.json(contact, { status: 200 });
}
