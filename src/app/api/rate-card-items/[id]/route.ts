import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardItemService } from "@/services/rate-card-item.service";
import {
  RateCardLockedError,
  RateCardItemNotFoundError,
  RateCardNotFoundError,
} from "@/domain/rate-cards/errors";

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  rateCardId: z.string().uuid(),
  price: z.number().int().nonnegative().optional(),
  unitDescription: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = updateSchema.parse(await request.json());
  const { organizationId, rateCardId, ...input } = payload;

  try {
    const item = await RateCardItemService.updateItem(db, organizationId, id, rateCardId, input);
    return NextResponse.json(item, { status: 200 });
  } catch (error) {
    if (error instanceof RateCardLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof RateCardItemNotFoundError || error instanceof RateCardNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

const deleteSchema = z.object({
  organizationId: z.string().uuid(),
  rateCardId: z.string().uuid(),
});

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = deleteSchema.parse(await request.json());

  try {
    await RateCardItemService.removeItem(db, payload.organizationId, id, payload.rateCardId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof RateCardLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof RateCardItemNotFoundError || error instanceof RateCardNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
