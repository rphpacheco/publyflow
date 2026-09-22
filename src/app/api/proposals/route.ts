import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalService } from "@/services/proposal.service";
import { OpportunityNotFoundError } from "@/domain/proposals/errors";

const templateEnum = z.enum(["PREMIUM", "MINIMAL", "EDITORIAL", "FASHION", "BEAUTY", "CORPORATE"]);

const createSchema = z.object({
  organizationId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  title: z.string().min(1),
  template: templateEnum,
  userId: z.string().uuid(),
});

export async function POST(request: Request) {
  const payload = createSchema.parse(await request.json());

  try {
    const proposal = await ProposalService.create(db, payload.organizationId, {
      opportunityId: payload.opportunityId,
      title: payload.title,
      template: payload.template,
      userId: payload.userId,
    });
    return NextResponse.json(proposal, { status: 201 });
  } catch (error) {
    if (error instanceof OpportunityNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

const listQuerySchema = z.object({
  organizationId: z.string().uuid(),
  opportunityId: z.string().uuid(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = listQuerySchema.parse({
    organizationId: url.searchParams.get("organizationId"),
    opportunityId: url.searchParams.get("opportunityId"),
  });
  const list = await ProposalService.listByOpportunity(db, payload.organizationId, payload.opportunityId);
  return NextResponse.json(list, { status: 200 });
}
