import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalService } from "@/services/proposal.service";
import { ProposalNotFoundError } from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;

  const proposal = await ProposalService.findById(db, session.organizationId, id);
  if (!proposal) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }
  return NextResponse.json(proposal, { status: 200 });
}

const themeEnum = z.enum(["PREMIUM", "MINIMAL", "EDITORIAL", "FASHION", "BEAUTY", "CORPORATE"]);
const statusEnum = z.enum(["DRAFT", "ARCHIVED"]);

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  theme: themeEnum.optional(),
  status: statusEnum.optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const payload = updateSchema.parse(await request.json());

  try {
    const proposal = await ProposalService.update(db, session.organizationId, id, {
      ...payload,
      userId: session.userId,
    });
    return NextResponse.json(proposal, { status: 200 });
  } catch (error) {
    if (error instanceof ProposalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
