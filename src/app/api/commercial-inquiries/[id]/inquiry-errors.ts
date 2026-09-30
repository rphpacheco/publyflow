import { NextResponse } from "next/server";
import {
  AmbiguousPartyGuessError,
  InquiryAlreadyResolvedError,
  InquiryNotFoundError,
  InquiryPartyRequiredError,
  InvalidOpportunityPartyError,
} from "@/domain/commercial-flow/errors";

export const INQUIRY_NOT_FOUND = "Mensagem não encontrada.";
const PARTY_REQUIRED = "Informe a empresa ou a marca antes de converter.";

export function inquiryNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: INQUIRY_NOT_FOUND }, { status: 404 });
}

/** Maps inquiry domain errors to user-facing Portuguese responses; null = not an inquiry error (rethrow). */
export function inquiryErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof InquiryNotFoundError) return inquiryNotFoundResponse();
  if (error instanceof InquiryAlreadyResolvedError) {
    return NextResponse.json({ error: "Esta mensagem já foi resolvida." }, { status: 409 });
  }
  if (error instanceof AmbiguousPartyGuessError) {
    return NextResponse.json(
      { error: "Mais de uma empresa ou marca com esse nome — selecione a correta.", code: "AMBIGUOUS_PARTY" },
      { status: 422 },
    );
  }
  if (error instanceof InquiryPartyRequiredError || error instanceof InvalidOpportunityPartyError) {
    return NextResponse.json({ error: PARTY_REQUIRED, code: "PARTY_REQUIRED" }, { status: 422 });
  }
  return null;
}
