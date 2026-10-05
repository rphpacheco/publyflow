import { ApiError } from "@/lib/api-client";

export interface FormErrors<F extends string> {
  fieldErrors: Partial<Record<F, string>>;
  formError: string | null;
}

/** Same idea as creator-form-dialog's toFieldErrors, shared by the CRM dialogs. */
export function toFormErrors<F extends string>(error: unknown, fields: readonly F[], conflictField?: F): FormErrors<F> {
  if (!(error instanceof ApiError)) {
    return { fieldErrors: {}, formError: "Não foi possível salvar. Tente novamente." };
  }
  if (error.status === 409 && conflictField) {
    return { fieldErrors: { [conflictField]: error.message } as Partial<Record<F, string>>, formError: null };
  }
  const code = (error.body as { code?: string } | null)?.code;
  if (code === "COMPANY_NOT_FOUND" && (fields as readonly string[]).includes("companyId")) {
    return { fieldErrors: { companyId: error.message } as Partial<Record<F, string>>, formError: null };
  }
  const errors = (error.body as { errors?: Record<string, string[] | undefined> } | null)?.errors ?? {};
  const fieldErrors: Partial<Record<F, string>> = {};
  for (const field of fields) {
    const first = errors[field]?.[0];
    if (first) fieldErrors[field] = first;
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, formError: null };
  return { fieldErrors: {}, formError: error.message };
}
