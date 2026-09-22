import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardItemService } from "@/services/rate-card-item.service";
import {
  RateCardLockedError,
  RateCardNotFoundError,
  ServiceNotFoundError,
  ServiceMismatchError,
} from "@/domain/rate-cards/errors";

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  serviceId: z.string().uuid(),
  price: z.number().int().nonnegative(),
  unitDescription: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());

  try {
    const item = await RateCardItemService.addItem(db, payload.organizationId, {
      rateCardId: id,
      serviceId: payload.serviceId,
      price: payload.price,
      unitDescription: payload.unitDescription,
      sortOrder: payload.sortOrder,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof RateCardLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof RateCardNotFoundError || error instanceof ServiceNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    // Not a "not found" (the rate card and service both resolve fine in
    // the caller's org) -- it's a request that violates the per-creator
    // catalog invariant, so 422 rather than 404.
    if (error instanceof ServiceMismatchError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
