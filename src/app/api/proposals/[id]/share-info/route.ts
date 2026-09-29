import { NextResponse } from "next/server";
import { db } from "@/db";
import { ProposalShareService } from "@/services/proposal-share.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { ProposalNotFoundError } from "@/domain/proposals/errors";
import { isUuid } from "@/lib/uuid";
import { proposalOutOfScope } from "@/lib/auth/proposal-scope";

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

  const info = await ProposalShareService.getShareInfo(db, session.organizationId, id);
  if (!info) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }
  return NextResponse.json(info, { status: 200 });
}
