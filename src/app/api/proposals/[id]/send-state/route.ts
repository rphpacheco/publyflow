import { NextResponse } from "next/server";
import { db } from "@/db";
import { ProposalSendingService } from "@/services/proposal-sending.service";
import { ProposalNotFoundError } from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }

  const state = await ProposalSendingService.getSendState(db, session.organizationId, id);
  if (!state) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }
  return NextResponse.json(state, { status: 200 });
}
