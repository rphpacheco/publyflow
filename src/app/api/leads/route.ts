import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { LeadService } from "@/services/lead.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

const querySchema = z.object({
  creatorId: z.string().uuid(),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const url = new URL(request.url);
  const payload = querySchema.parse({
    creatorId: url.searchParams.get("creatorId"),
  });
  const list = await LeadService.listByCreator(db, session.organizationId, payload.creatorId);
  return NextResponse.json(list, { status: 200 });
}
