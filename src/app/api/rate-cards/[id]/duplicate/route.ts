import { NextResponse } from "next/server";
import { z } from "zod";
import { validationError } from "@/lib/api-validation";
import { db } from "@/db";
import { RateCardService } from "@/services/rate-card.service";
import { RateCardNotFoundError } from "@/domain/rate-cards/errors";
import { getRouteSession } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";
import { denyCreatorWrite } from "@/lib/auth/access";

const bodySchema = z.object({
  name: z.string().min(1),
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
    return validationError(parsed.error);
  }
  const payload = parsed.data;
  const result = await RateCardService.duplicate(db, session.organizationId, id, {
    name: payload.name,
  });
  return NextResponse.json(result, { status: 201 });
}
