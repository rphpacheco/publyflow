import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalResponseService } from "@/services/proposal-response.service";
import {
  ProposalUnavailableError,
  PublicProposalNotFoundError,
  PublicationAlreadyRespondedError,
  PublicationSupersededError,
} from "@/domain/proposals/errors";

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z
  .object({
    publicationId: z.uuid(),
    action: z.enum(["ACCEPT", "REQUEST_CHANGES", "REJECT"]),
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    message: z.string().trim().max(2000).nullish(),
  })
  .refine((body) => body.action !== "REQUEST_CHANGES" || !!body.message, {
    path: ["message"],
    message: "Descreva os ajustes que você gostaria.",
  });

// Public: no session. Everything resolves through token → proposal → publication.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400, headers: NO_STORE });
  }

  try {
    const response = await ProposalResponseService.respond(db, token, {
      publicationId: parsed.data.publicationId,
      action: parsed.data.action,
      name: parsed.data.name,
      email: parsed.data.email,
      message: parsed.data.message || null,
    });
    return NextResponse.json({ response }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof PublicProposalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404, headers: NO_STORE });
    }
    if (error instanceof ProposalUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 410, headers: NO_STORE });
    }
    if (error instanceof PublicationSupersededError || error instanceof PublicationAlreadyRespondedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409, headers: NO_STORE });
    }
    throw error;
  }
}
