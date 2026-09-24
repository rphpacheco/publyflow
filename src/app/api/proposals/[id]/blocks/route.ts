import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalBlockService } from "@/services/proposal-block.service";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

const getQuerySchema = z.object({ organizationId: z.string().uuid() });

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
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  blockType: blockTypeEnum,
  content: z.unknown(),
  sortOrder: z.number().int().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = getQuerySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const blocks = await ProposalBlockService.listByProposal(db, payload.organizationId, id);
  return NextResponse.json(blocks, { status: 200 });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());

  try {
    const block = await ProposalBlockService.addBlock(db, payload.organizationId, {
      proposalId: id,
      blockType: payload.blockType,
      content: payload.content,
      sortOrder: payload.sortOrder,
      userId: payload.userId,
    });
    return NextResponse.json(block, { status: 201 });
  } catch (error) {
    if (error instanceof ProposalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
