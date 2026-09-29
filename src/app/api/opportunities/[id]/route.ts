import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { OpportunityService } from "@/services/opportunity.service";
import { OpportunityNotFoundError } from "@/domain/commercial-flow/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";
import { creatorScope, denyCreatorWrite } from "@/lib/auth/access";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new OpportunityNotFoundError(id).message }, { status: 404 });
  }

  const opportunity = await OpportunityService.findById(db, session.organizationId, id, creatorScope(session));
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
  stage: stageEnum,
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new OpportunityNotFoundError(id).message }, { status: 404 });
  }

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const payload = patchSchema.parse(await request.json());

  try {
    const opportunity = await OpportunityService.changeStage(
      db,
      session.organizationId,
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
