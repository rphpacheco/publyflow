import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalItemService } from "@/services/proposal-item.service";
import { ProposalItemNotFoundError } from "@/domain/proposals/errors";

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  proposalId: z.string().uuid(),
  userId: z.string().uuid(),
  description: z.string().min(1).optional(),
  unitPrice: z.number().int().optional(),
  quantity: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = updateSchema.parse(await request.json());
  const { organizationId, proposalId, ...input } = payload;

  try {
    const item = await ProposalItemService.updateItem(db, organizationId, id, proposalId, input);
    return NextResponse.json(item, { status: 200 });
  } catch (error) {
    if (error instanceof ProposalItemNotFoundError) {
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
    await ProposalItemService.removeItem(db, payload.organizationId, id, payload.proposalId, payload.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ProposalItemNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
