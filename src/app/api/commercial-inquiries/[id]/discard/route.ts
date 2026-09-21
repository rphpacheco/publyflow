import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";

const bodySchema = z.object({ organizationId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());
  await CommercialInquiryService.discard(db, payload.organizationId, id);
  return new NextResponse(null, { status: 204 });
}
