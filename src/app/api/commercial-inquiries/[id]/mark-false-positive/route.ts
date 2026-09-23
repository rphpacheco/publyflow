import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import { InquiryNotFoundError, InquiryAlreadyResolvedError } from "@/domain/commercial-flow/errors";

const bodySchema = z.object({ organizationId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());

  try {
    await CommercialInquiryService.markFalsePositive(db, payload.organizationId, id);
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
