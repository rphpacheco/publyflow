import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { denyCreatorWrite } from "@/lib/auth/access";
import { isUuid } from "@/lib/uuid";
import { inquiryErrorResponse, inquiryNotFoundResponse } from "./inquiry-errors";

const field = z.string().max(200, "Use no máximo 200 caracteres.").nullable().optional();
const bodySchema = z
  .object({ contactName: field, companyName: field, brandName: field })
  .refine((value) => Object.values(value).some((v) => v !== undefined), { message: "Informe ao menos um campo." });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  try {
    const inquiry = await CommercialInquiryService.updateGuesses(db, session.organizationId, id, parsed.data);
    return NextResponse.json(inquiry, { status: 200 });
  } catch (error) {
    const mapped = inquiryErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
