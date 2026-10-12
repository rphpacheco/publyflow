import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardItemService } from "@/services/rate-card-item.service";
import { forbiddenResponse, getRouteSession } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";

const listQuerySchema = z.object({
  creatorId: z.string().uuid(),
});

export async function GET(request: Request) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;

  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    creatorId: url.searchParams.get("creatorId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }
  const payload = parsed.data;
  const items = await RateCardItemService.listByCreator(db, session.organizationId, payload.creatorId);
  return NextResponse.json(items, { status: 200 });
}
