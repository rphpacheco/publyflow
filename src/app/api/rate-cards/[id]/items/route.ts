import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardItemService } from "@/services/rate-card-item.service";
import { RateCardLockedError } from "@/domain/rate-cards/errors";

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
    throw error;
  }
}
