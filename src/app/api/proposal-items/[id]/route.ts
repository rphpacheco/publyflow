import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalItemService } from "@/services/proposal-item.service";
import { ProposalItemNotFoundError } from "@/domain/proposals/errors";
import { getRouteSession } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";
import { denyCreatorWrite } from "@/lib/auth/access";

const updateSchema = z.object({
  proposalId: z.string().uuid(),
  description: z.string().min(1).optional(),
  unitPrice: z.number().int().optional(),
  quantity: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  }

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }
  const { proposalId, ...input } = parsed.data;

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
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  }

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }
  const payload = parsed.data;

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
