import { NextResponse } from "next/server";
import {
  BrandNotFoundError,
  CompanyNameTakenError,
  CompanyNotFoundError,
  CompanyRefNotFoundError,
  ContactNotFoundError,
} from "@/domain/crm/errors";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

export const COMPANY_NOT_FOUND = "Empresa não encontrada.";
export const CONTACT_NOT_FOUND = "Contato não encontrado.";
export const BRAND_NOT_FOUND = "Brand não encontrada.";

export function notFoundResponse(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** Maps CRM domain errors to user-facing Portuguese responses; null = unknown error (rethrow). */
export function crmErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof CompanyNotFoundError) return notFoundResponse(COMPANY_NOT_FOUND);
  if (error instanceof ContactNotFoundError) return notFoundResponse(CONTACT_NOT_FOUND);
  if (error instanceof BrandNotFoundError) return notFoundResponse(BRAND_NOT_FOUND);
  if (error instanceof CompanyNameTakenError) {
    return NextResponse.json({ error: "Já existe uma empresa com esse nome.", code: "COMPANY_NAME_TAKEN" }, { status: 409 });
  }
  if (error instanceof CompanyRefNotFoundError) {
    return NextResponse.json({ error: "Empresa selecionada não encontrada.", code: "COMPANY_NOT_FOUND" }, { status: 422 });
  }
  if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
  return null;
}
