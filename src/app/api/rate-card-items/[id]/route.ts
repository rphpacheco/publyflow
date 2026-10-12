import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardItemService } from "@/services/rate-card-item.service";
import {
  RateCardLockedError,
  RateCardItemNotFoundError,
  RateCardNotFoundError,
} from "@/domain/rate-cards/errors";
import { getRouteSession } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";
import { denyCreatorWrite } from "@/lib/auth/access";

const updateSchema = z.object({
  rateCardId: z.string().uuid(),
  price: z.number().int().nonnegative().optional(),
  unitDescription: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  }

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }
  const payload = parsed.data;
  const { rateCardId, ...input } = payload;

  try {
    const item = await RateCardItemService.updateItem(db, session.organizationId, id, rateCardId, input);
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
  rateCardId: z.string().uuid(),
});

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  }

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }
  const payload = parsed.data;

  try {
    await RateCardItemService.removeItem(db, session.organizationId, id, payload.rateCardId);
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
