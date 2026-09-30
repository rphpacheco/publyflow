import { NextResponse } from "next/server";
import { db } from "@/db";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { creatorScope, isCreator } from "@/lib/auth/access";
import { ProposalQueueService } from "@/services/proposal-queue.service";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const scope = creatorScope(session);
  if (isCreator(session) && scope === null) {
    return NextResponse.json({ items: [], closedCount: 0, truncated: false }, { status: 200 });
  }

  const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "1";
  const result = await ProposalQueueService.list(db, session.organizationId, { creatorScope: scope, includeArchived });
  return NextResponse.json(result, { status: 200 });
}
