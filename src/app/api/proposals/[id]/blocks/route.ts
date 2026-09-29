import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalBlockService } from "@/services/proposal-block.service";
import { ProposalNotFoundError } from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";
import { denyCreatorWrite } from "@/lib/auth/access";
import { proposalOutOfScope } from "@/lib/auth/proposal-scope";

const blockTypeEnum = z.enum([
  "COVER",
  "TEXT",
  "IMAGE",
  "METRICS",
  "SERVICES",
  "PRICING",
  "TIMELINE",
  "GALLERY",
  "TESTIMONIALS",
  "SOCIAL_LINKS",
  "FOOTER",
]);

const bodySchema = z.object({
  blockType: blockTypeEnum,
  content: z.unknown(),
  sortOrder: z.number().int().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }

  if (await proposalOutOfScope(db, session, id)) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }

  const blocks = await ProposalBlockService.listByProposal(db, session.organizationId, id);
  return NextResponse.json(blocks, { status: 200 });
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
    const block = await ProposalBlockService.addBlock(db, session.organizationId, {
      proposalId: id,
      blockType: payload.blockType,
      content: payload.content,
      sortOrder: payload.sortOrder,
      userId: session.userId,
    });
    return NextResponse.json(block, { status: 201 });
  } catch (error) {
    if (error instanceof ProposalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
