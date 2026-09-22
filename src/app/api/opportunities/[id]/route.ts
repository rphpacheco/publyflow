import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { OpportunityNotFoundError } from "@/domain/commercial-flow/errors";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const opportunity = await OpportunitiesRepository.findById(db, payload.organizationId, id);
  if (!opportunity) {
    return NextResponse.json(
      { error: new OpportunityNotFoundError(id).message },
      { status: 404 },
    );
  }
  return NextResponse.json(opportunity, { status: 200 });
}
