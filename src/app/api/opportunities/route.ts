import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { OpportunityService } from "@/services/opportunity.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { creatorScope } from "@/lib/auth/access";

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
  creatorId: z.string().uuid(),
  stage: stageEnum.optional(),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const url = new URL(request.url);
  const payload = querySchema.parse({
    creatorId: url.searchParams.get("creatorId"),
    stage: url.searchParams.get("stage") ?? undefined,
  });

  const scope = creatorScope(session);
  const effectiveCreatorId = scope ?? payload.creatorId;

  const list = await OpportunityService.listByCreator(
    db,
    session.organizationId,
    effectiveCreatorId,
    payload.stage,
  );
  return NextResponse.json(list, { status: 200 });
}
