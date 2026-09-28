import { NextResponse } from "next/server";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import { InquiryNotFoundError } from "@/domain/commercial-flow/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new InquiryNotFoundError(id).message }, { status: 404 });
  }
  await CommercialInquiryService.discard(db, session.organizationId, id);
  return new NextResponse(null, { status: 204 });
}
