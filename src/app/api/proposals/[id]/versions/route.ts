import { NextResponse } from "next/server";
import { db } from "@/db";
import { ProposalVersionService } from "@/services/proposal-version.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const versions = await ProposalVersionService.listByProposal(db, session.organizationId, id);
  return NextResponse.json(versions, { status: 200 });
}
