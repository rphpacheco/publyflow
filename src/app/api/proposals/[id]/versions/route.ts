import { NextResponse } from "next/server";
import { db } from "@/db";
import { ProposalVersionService } from "@/services/proposal-version.service";
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
  const versions = await ProposalVersionService.listByProposal(db, session.organizationId, id);
  return NextResponse.json(versions, { status: 200 });
}
