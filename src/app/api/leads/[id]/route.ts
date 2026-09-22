import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { LeadService } from "@/services/lead.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const lead = await LeadService.findById(db, payload.organizationId, id);
  if (!lead) {
    return NextResponse.json({ error: `Lead ${id} not found` }, { status: 404 });
  }
  return NextResponse.json(lead, { status: 200 });
}
