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
import { getRouteSession } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";
import { denyCreatorWrite } from "@/lib/auth/access";

const bodySchema = z.object({
  serviceId: z.string().uuid(),
  price: z.number().int().nonnegative(),
  unitDescription: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new RateCardNotFoundError(id).message }, { status: 404 });
  }

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }
  const payload = parsed.data;

  try {
    const item = await RateCardItemService.addItem(db, session.organizationId, {
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
