import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { LeadService } from "@/services/lead.service";

const querySchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = querySchema.parse({
    organizationId: url.searchParams.get("organizationId"),
    creatorId: url.searchParams.get("creatorId"),
  });
  const list = await LeadService.listByCreator(db, payload.organizationId, payload.creatorId);
  return NextResponse.json(list, { status: 200 });
}
