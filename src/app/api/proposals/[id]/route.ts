import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalService } from "@/services/proposal.service";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

const getQuerySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = getQuerySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const proposal = await ProposalService.findById(db, payload.organizationId, id);
  if (!proposal) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }
  return NextResponse.json(proposal, { status: 200 });
}

const templateEnum = z.enum(["PREMIUM", "MINIMAL", "EDITORIAL", "FASHION", "BEAUTY", "CORPORATE"]);
const statusEnum = z.enum(["DRAFT", "ARCHIVED"]);

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  title: z.string().min(1).optional(),
  template: templateEnum.optional(),
  status: statusEnum.optional(),
  userId: z.string().uuid(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = updateSchema.parse(await request.json());
  const { organizationId, ...input } = payload;

  try {
    const proposal = await ProposalService.update(db, organizationId, id, input);
    return NextResponse.json(proposal, { status: 200 });
  } catch (error) {
    if (error instanceof ProposalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
