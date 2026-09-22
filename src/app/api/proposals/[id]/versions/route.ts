import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalVersionService } from "@/services/proposal-version.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });
  const versions = await ProposalVersionService.listByProposal(db, payload.organizationId, id);
  return NextResponse.json(versions, { status: 200 });
}
