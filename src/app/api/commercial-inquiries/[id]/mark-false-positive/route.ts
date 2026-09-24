import { NextResponse } from "next/server";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import { InquiryNotFoundError, InquiryAlreadyResolvedError } from "@/domain/commercial-flow/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;

  try {
    await CommercialInquiryService.markFalsePositive(db, session.organizationId, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof InquiryNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof InquiryAlreadyResolvedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
