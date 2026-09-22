import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalService } from "@/services/proposal.service";

const templateEnum = z.enum(["PREMIUM", "MINIMAL", "EDITORIAL", "FASHION", "BEAUTY", "CORPORATE"]);
const statusEnum = z.enum(["DRAFT", "ARCHIVED"]);

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  title: z.string().min(1).optional(),
  template: templateEnum.optional(),
  status: statusEnum.optional(),
  userId: z.string().uuid(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = updateSchema.parse(await request.json());
  const { organizationId, ...input } = payload;
  const proposal = await ProposalService.update(db, organizationId, id, input);
  return NextResponse.json(proposal, { status: 200 });
}
