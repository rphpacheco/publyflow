import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";
import { denyCreatorWrite } from "@/lib/auth/access";
import { inquiryErrorResponse, inquiryNotFoundResponse } from "../inquiry-errors";

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
  if (!isUuid(id)) return inquiryNotFoundResponse();

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error) }, { status: 400 });
  }
  const payload = parsed.data;
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
    const mapped = inquiryErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
