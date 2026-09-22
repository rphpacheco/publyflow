import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalBlockService } from "@/services/proposal-block.service";
import { ProposalBlockNotFoundError } from "@/domain/proposals/errors";

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  proposalId: z.string().uuid(),
  userId: z.string().uuid(),
  content: z.unknown().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = updateSchema.parse(await request.json());
  const { organizationId, proposalId, ...input } = payload;

  try {
    const block = await ProposalBlockService.updateBlock(db, organizationId, id, proposalId, input);
    return NextResponse.json(block, { status: 200 });
  } catch (error) {
    if (error instanceof ProposalBlockNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

const deleteSchema = z.object({
  organizationId: z.string().uuid(),
  proposalId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = deleteSchema.parse(await request.json());

  try {
    await ProposalBlockService.removeBlock(db, payload.organizationId, id, payload.proposalId, payload.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ProposalBlockNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
