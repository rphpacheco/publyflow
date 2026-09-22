import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { OpportunityService } from "@/services/opportunity.service";
import { OpportunityNotFoundError } from "@/domain/commercial-flow/errors";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const opportunity = await OpportunitiesRepository.findById(db, payload.organizationId, id);
  if (!opportunity) {
    return NextResponse.json(
      { error: new OpportunityNotFoundError(id).message },
      { status: 404 },
    );
  }
  return NextResponse.json(opportunity, { status: 200 });
}

const stageEnum = z.enum([
  "NOVO_LEAD",
  "QUALIFICACAO",
  "PRIMEIRO_CONTATO",
  "MIDIA_KIT_ENVIADO",
  "PROPOSTA_SOLICITADA",
  "PROPOSTA_ENVIADA",
  "NEGOCIACAO",
  "AGUARDANDO_CLIENTE",
  "FECHADO",
  "PERDIDO",
]);

const patchSchema = z.object({
  organizationId: z.string().uuid(),
  stage: stageEnum,
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = patchSchema.parse(await request.json());

  try {
    const opportunity = await OpportunityService.changeStage(
      db,
      payload.organizationId,
      id,
      payload.stage,
    );
    return NextResponse.json(opportunity, { status: 200 });
  } catch (error) {
    if (error instanceof OpportunityNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
