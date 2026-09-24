import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardService } from "@/services/rate-card.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

const bodySchema = z.object({
  name: z.string().min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const payload = bodySchema.parse(await request.json());
  const result = await RateCardService.duplicate(db, session.organizationId, id, {
    name: payload.name,
  });
  return NextResponse.json(result, { status: 201 });
}
