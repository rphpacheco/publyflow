import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";

const bodySchema = z.object({
  organizationId: z.string().uuid(),
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
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());
  const result = await CommercialInquiryService.resolve(db, payload.organizationId, id, {
    contact: payload.contact,
    companyId: payload.companyId ?? null,
    brandId: payload.brandId ?? null,
  });
  return NextResponse.json(result, { status: 200 });
}
