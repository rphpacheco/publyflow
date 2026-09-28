import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalResponseService } from "@/services/proposal-response.service";
import { scheduleEventDrain } from "@/lib/events/schedule-drain";
import {
  ProposalUnavailableError,
  PublicProposalNotFoundError,
  PublicationAlreadyRespondedError,
  PublicationSupersededError,
} from "@/domain/proposals/errors";
import { checkRateLimit, PUBLIC_RESPONSE_LIMIT } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import {
  MAX_PUBLIC_BODY_BYTES,
  PayloadTooLargeError,
  declaredLengthExceeds,
  readJsonWithLimit,
} from "@/lib/read-json-with-limit";

const NO_STORE = { "Cache-Control": "no-store" };
const TOO_LARGE = { error: "Requisição muito grande." };

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
  if (declaredLengthExceeds(request, MAX_PUBLIC_BODY_BYTES)) {
    return NextResponse.json(TOO_LARGE, { status: 413, headers: NO_STORE });
  }

  const limit = await checkRateLimit(db, { ...PUBLIC_RESPONSE_LIMIT, ip: clientIp(request.headers) });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente novamente em alguns minutos." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let raw: unknown;
  try {
    raw = await readJsonWithLimit(request, MAX_PUBLIC_BODY_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json(TOO_LARGE, { status: 413, headers: NO_STORE });
    }
    throw error;
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400, headers: NO_STORE });
  }

  try {
    const response = await ProposalResponseService.respond(db, token, {
      publicationId: parsed.data.publicationId,
      action: parsed.data.action,
      name: parsed.data.name,
      email: parsed.data.email,
      message: parsed.data.action === "ACCEPT" ? null : parsed.data.message || null,
    });
    scheduleEventDrain();
    return NextResponse.json(
      { response: { action: response.action, respondedAt: response.respondedAt } },
      { status: 201, headers: NO_STORE },
    );
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
