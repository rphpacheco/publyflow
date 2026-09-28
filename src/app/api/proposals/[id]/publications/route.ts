import { NextResponse } from "next/server";
import { db } from "@/db";
import { ProposalSendingService } from "@/services/proposal-sending.service";
import { ProposalArchivedError, ProposalNotFoundError, UserNotOrganizationMemberError } from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { scheduleEventDrain } from "@/lib/events/schedule-drain";
import { isUuid } from "@/lib/uuid";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }

  try {
    const result = await ProposalSendingService.publish(db, session.organizationId, id, session.userId);
    if (result.created) scheduleEventDrain();
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ProposalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ProposalArchivedError) {
      return NextResponse.json({ error: error.message, code: "PROPOSAL_ARCHIVED" }, { status: 409 });
    }
    if (error instanceof UserNotOrganizationMemberError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }

  const history = await ProposalSendingService.listPublications(db, session.organizationId, id);
  if (!history) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }
  return NextResponse.json(history, { status: 200 });
}
