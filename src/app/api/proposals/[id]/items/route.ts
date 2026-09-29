import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalItemService } from "@/services/proposal-item.service";
import {
  ProposalNotFoundError,
  OpportunityNotFoundError,
  RateCardItemCreatorMismatchError,
} from "@/domain/proposals/errors";
import { RateCardItemNotFoundError } from "@/domain/rate-cards/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";
import { creatorScope, denyCreatorWrite } from "@/lib/auth/access";
import { ProposalsRepository } from "@/repositories/proposals.repository";

const catalogSchema = z.object({
  rateCardItemId: z.string().uuid(),
  quantity: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
});

const adHocSchema = z.object({
  description: z.string().min(1),
  unitPrice: z.number().int(),
  quantity: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
});

const bodySchema = z.union([catalogSchema, adHocSchema]);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }

  const scope = creatorScope(session);
  if (scope !== null && !(await ProposalsRepository.isInCreatorScope(db, session.organizationId, id, scope))) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }

  const items = await ProposalItemService.listByProposal(db, session.organizationId, id);
  return NextResponse.json(items, { status: 200 });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const payload = bodySchema.parse(await request.json());

  try {
    const item = await ProposalItemService.addItem(db, session.organizationId, {
      proposalId: id,
      quantity: payload.quantity,
      sortOrder: payload.sortOrder,
      userId: session.userId,
      ...("rateCardItemId" in payload
        ? { rateCardItemId: payload.rateCardItemId }
        : { description: payload.description, unitPrice: payload.unitPrice }),
    } as Parameters<typeof ProposalItemService.addItem>[2]);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (
      error instanceof ProposalNotFoundError ||
      error instanceof OpportunityNotFoundError ||
      error instanceof RateCardItemNotFoundError
    ) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RateCardItemCreatorMismatchError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
