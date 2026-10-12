import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardService } from "@/services/rate-card.service";
import { forbiddenResponse, getRouteSession } from "@/lib/auth/http";
import { canManageOrganization, denyCreatorWrite } from "@/lib/auth/access";

const createSchema = z.object({
  creatorId: z.string().uuid(),
  name: z.string().min(1),
  validFrom: z.string().datetime().nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }
  const payload = parsed.data;
  const rateCard = await RateCardService.create(db, session.organizationId, {
    creatorId: payload.creatorId,
    name: payload.name,
    validFrom: payload.validFrom ? new Date(payload.validFrom) : null,
    validTo: payload.validTo ? new Date(payload.validTo) : null,
  });
  return NextResponse.json(rateCard, { status: 201 });
}

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
  const list = await RateCardService.listByCreator(db, session.organizationId, payload.creatorId);
  return NextResponse.json(list, { status: 200 });
}
