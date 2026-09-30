import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import type { ProposalApproval } from "@/repositories/proposal-approvals.repository";
import {
  ApprovalStaleError,
  NoPendingApprovalError,
  NotProposalCreatorError,
  ProposalNotFoundError,
} from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isCreator } from "@/lib/auth/access";
import { proposalOutOfScope } from "@/lib/auth/proposal-scope";
import { scheduleEventDrain } from "@/lib/events/schedule-drain";
import { isUuid } from "@/lib/uuid";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

const TOO_LONG = "Use no máximo 2000 caracteres.";
export const approveSchema = z.object({ message: z.string().trim().max(2000, TOO_LONG).optional() });
export const requestChangesSchema = z.object({ message: z.string().trim().min(1, "Descreva os ajustes.").max(2000, TOO_LONG) });

/**
 * Creator-only write (spec D §4.4) — exempt from denyCreatorWrite on purpose;
 * the allowlist in write-guard.test.ts names both routes.
 */
export async function handleCreatorDecision(
  request: Request,
  params: Promise<{ id: string }>,
  schema: typeof approveSchema | typeof requestChangesSchema,
  run: (organizationId: string, proposalId: string, userId: string, message: string | null) => Promise<ProposalApproval>,
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const notFound = () => NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  if (!isUuid(id)) return notFound();
  if (!isCreator(session)) return NextResponse.json({ error: "Somente o creator pode aprovar." }, { status: 403 });
  if (await proposalOutOfScope(db, session, id)) return notFound();

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    const approval = await run(session.organizationId, id, session.userId, parsed.data.message ?? null);
    scheduleEventDrain();
    return NextResponse.json({ approval }, { status: 200 });
  } catch (error) {
    if (error instanceof ProposalNotFoundError) return notFound();
    if (error instanceof NotProposalCreatorError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof NoPendingApprovalError || error instanceof ApprovalStaleError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
    throw error;
  }
}
