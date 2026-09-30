import { NextResponse } from "next/server";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";
import { denyCreatorWrite } from "@/lib/auth/access";
import { inquiryErrorResponse, inquiryNotFoundResponse } from "../inquiry-errors";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) return inquiryNotFoundResponse();

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  try {
    await CommercialInquiryService.discard(db, session.organizationId, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const mapped = inquiryErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
