import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { creatorScope } from "@/lib/auth/access";

const statusEnum = z.enum(["NEW", "DISCARDED", "FALSE_POSITIVE", "CONVERTED"]);

const listQuerySchema = z.object({
  creatorId: z.string().uuid(),
  status: statusEnum.optional(),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const url = new URL(request.url);
  const payload = listQuerySchema.parse({
    creatorId: url.searchParams.get("creatorId"),
    status: url.searchParams.get("status") ?? undefined,
  });
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
