import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import {
  InquiryNotFoundError,
  InquiryAlreadyResolvedError,
  AmbiguousPartyGuessError,
} from "@/domain/commercial-flow/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";

const bodySchema = z.object({
  contact: z.union([
    z.object({ id: z.string().uuid() }),
    z.object({
      fullName: z.string().min(1),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
    }),
  ]),
  companyId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new InquiryNotFoundError(id).message }, { status: 404 });
  }
  const payload = bodySchema.parse(await request.json());
  // companyId/brandId are left as-is (undefined when omitted from the
  // request body, distinct from an explicit `null`) so
  // CommercialInquiryService.resolve can tell "not provided -- resolve
  // from the AI's guess" apart from "explicitly no company/brand".
  try {
    const result = await CommercialInquiryService.resolve(db, session.organizationId, id, {
      contact: payload.contact,
      companyId: payload.companyId,
      brandId: payload.brandId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof InquiryNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof InquiryAlreadyResolvedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof AmbiguousPartyGuessError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
