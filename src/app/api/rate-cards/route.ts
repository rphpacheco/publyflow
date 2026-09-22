import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardService } from "@/services/rate-card.service";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
  name: z.string().min(1),
  validFrom: z.string().datetime().nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request) {
  const payload = createSchema.parse(await request.json());
  const rateCard = await RateCardService.create(db, payload.organizationId, {
    creatorId: payload.creatorId,
    name: payload.name,
    validFrom: payload.validFrom ? new Date(payload.validFrom) : null,
    validTo: payload.validTo ? new Date(payload.validTo) : null,
  });
  return NextResponse.json(rateCard, { status: 201 });
}

const listQuerySchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = listQuerySchema.parse({
    organizationId: url.searchParams.get("organizationId"),
    creatorId: url.searchParams.get("creatorId"),
  });
  const list = await RateCardService.listByCreator(db, payload.organizationId, payload.creatorId);
  return NextResponse.json(list, { status: 200 });
}
