import { NextResponse } from "next/server";
import { db } from "@/db";
import { ProposalShareService } from "@/services/proposal-share.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const info = UUID_RE.test(id) ? await ProposalShareService.getShareInfo(db, session.organizationId, id) : null;
  if (!info) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }
  return NextResponse.json(info, { status: 200 });
}
