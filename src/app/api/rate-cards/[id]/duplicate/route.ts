import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardService } from "@/services/rate-card.service";

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());
  const result = await RateCardService.duplicate(db, payload.organizationId, id, {
    name: payload.name,
  });
  return NextResponse.json(result, { status: 201 });
}
