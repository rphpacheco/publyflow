import { NextResponse } from "next/server";
import { db } from "@/db";
import { ProposalApprovalService } from "@/services/proposal-approval.service";
import {
  ApprovalNotRequiredError,
  ProposalArchivedError,
  ProposalNotFoundError,
  UserNotOrganizationMemberError,
} from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { denyCreatorWrite } from "@/lib/auth/access";
import { scheduleEventDrain } from "@/lib/events/schedule-drain";
import { isUuid } from "@/lib/uuid";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const notFound = () => NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  if (!isUuid(id)) return notFound();

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  try {
    const result = await ProposalApprovalService.request(db, session.organizationId, id, session.userId);
    if (result.created) scheduleEventDrain();
    return NextResponse.json({ approval: result.approval }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ProposalNotFoundError) return notFound();
    if (error instanceof ProposalArchivedError) {
      return NextResponse.json({ error: error.message, code: "PROPOSAL_ARCHIVED" }, { status: 409 });
    }
    if (error instanceof ApprovalNotRequiredError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof UserNotOrganizationMemberError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
    throw error;
  }
}
