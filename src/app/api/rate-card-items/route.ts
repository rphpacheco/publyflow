import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardItemService } from "@/services/rate-card-item.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

const listQuerySchema = z.object({
  creatorId: z.string().uuid(),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const url = new URL(request.url);
  const payload = listQuerySchema.parse({
    creatorId: url.searchParams.get("creatorId"),
  });
  const items = await RateCardItemService.listByCreator(db, session.organizationId, payload.creatorId);
  return NextResponse.json(items, { status: 200 });
}
