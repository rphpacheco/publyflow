import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardService } from "@/services/rate-card.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

const createSchema = z.object({
  creatorId: z.string().uuid(),
  name: z.string().min(1),
  validFrom: z.string().datetime().nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const payload = createSchema.parse(await request.json());
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
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const url = new URL(request.url);
  const payload = listQuerySchema.parse({
    creatorId: url.searchParams.get("creatorId"),
  });
  const list = await RateCardService.listByCreator(db, session.organizationId, payload.creatorId);
  return NextResponse.json(list, { status: 200 });
}
