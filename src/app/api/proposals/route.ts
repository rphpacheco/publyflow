import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalService } from "@/services/proposal.service";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { OpportunityNotFoundError } from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { creatorScope, denyCreatorWrite } from "@/lib/auth/access";

const themeEnum = z.enum(["PREMIUM", "MINIMAL", "EDITORIAL", "FASHION", "BEAUTY", "CORPORATE"]);

const createSchema = z.object({
  opportunityId: z.string().uuid(),
  title: z.string().min(1),
  theme: themeEnum,
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const payload = createSchema.parse(await request.json());

  try {
    const proposal = await ProposalService.create(db, session.organizationId, {
      opportunityId: payload.opportunityId,
      title: payload.title,
      theme: payload.theme,
      userId: session.userId,
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
  opportunityId: z.string().uuid(),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const url = new URL(request.url);
  const payload = listQuerySchema.parse({
    opportunityId: url.searchParams.get("opportunityId"),
  });

  const scope = creatorScope(session);
  if (scope !== null) {
    const opportunity = await OpportunitiesRepository.findById(db, session.organizationId, payload.opportunityId, scope);
    if (!opportunity) {
      return NextResponse.json([], { status: 200 });
    }
  }

  const list = await ProposalService.listByOpportunity(db, session.organizationId, payload.opportunityId);
  return NextResponse.json(list, { status: 200 });
}
