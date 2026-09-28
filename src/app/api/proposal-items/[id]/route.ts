import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalItemService } from "@/services/proposal-item.service";
import { ProposalItemNotFoundError } from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";

const updateSchema = z.object({
  proposalId: z.string().uuid(),
  description: z.string().min(1).optional(),
  unitPrice: z.number().int().optional(),
  quantity: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  }
  const { proposalId, ...input } = updateSchema.parse(await request.json());

  try {
    const item = await ProposalItemService.updateItem(db, session.organizationId, id, proposalId, {
      ...input,
      userId: session.userId,
    });
    return NextResponse.json(item, { status: 200 });
  } catch (error) {
    if (error instanceof ProposalItemNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

const deleteSchema = z.object({ proposalId: z.string().uuid() });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  }
  const payload = deleteSchema.parse(await request.json());

  try {
    await ProposalItemService.removeItem(db, session.organizationId, id, payload.proposalId, session.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ProposalItemNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
