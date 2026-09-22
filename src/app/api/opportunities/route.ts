import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { OpportunityService } from "@/services/opportunity.service";

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

const querySchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
  stage: stageEnum.optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = querySchema.parse({
    organizationId: url.searchParams.get("organizationId"),
    creatorId: url.searchParams.get("creatorId"),
    stage: url.searchParams.get("stage") ?? undefined,
  });
  const list = await OpportunityService.listByCreator(
    db,
    payload.organizationId,
    payload.creatorId,
    payload.stage,
  );
  return NextResponse.json(list, { status: 200 });
}
