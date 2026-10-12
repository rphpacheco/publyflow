import { NextResponse } from "next/server";
import { z } from "zod";
import { validationError } from "@/lib/api-validation";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import { getRouteSession } from "@/lib/auth/http";
import { creatorScope } from "@/lib/auth/access";

const statusEnum = z.enum(["NEW", "DISCARDED", "FALSE_POSITIVE", "CONVERTED"]);

const listQuerySchema = z.object({
  creatorId: z.string().uuid(),
  status: statusEnum.optional(),
});

export async function GET(request: Request) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    creatorId: url.searchParams.get("creatorId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const payload = parsed.data;
  const scope = creatorScope(session);
  const effectiveCreatorId = scope ?? payload.creatorId;

  const list = await CommercialInquiryService.listByCreator(
    db,
    session.organizationId,
    effectiveCreatorId,
    payload.status,
  );
  return NextResponse.json(list, { status: 200 });
}
