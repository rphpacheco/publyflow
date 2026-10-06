export class ApiError extends Error {
  status: number;
  readonly body: unknown;
  readonly requestId: string | null;

  constructor(status: number, message: string, body: unknown = null, requestId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

// F6: zod's `errors` (via z.flattenError().fieldErrors) has no top-level
// `error` string, only per-field arrays -- e.g. { companyName: ["Use no
// máximo 200 caracteres."] } or { form: ["Informe ao menos um campo."] }.
// Prefer the form-level entry (a whole-request error, like "no field was
// provided") when present, otherwise surface the first message of the
// first field so the toast reads as "what's wrong" instead of a generic
// "could not complete the action (400)".
export function isApiErrorCode(error: unknown, status: number, code: string): boolean {
  return (
    error instanceof ApiError &&
    error.status === status &&
    typeof error.body === "object" &&
    error.body !== null &&
    (error.body as { code?: unknown }).code === code
  );
}

function firstFieldErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const errors = (body as { errors?: unknown }).errors;
  if (!errors || typeof errors !== "object") return null;
  const fieldErrors = errors as Record<string, unknown>;
  const formMessages = fieldErrors.form;
  if (Array.isArray(formMessages) && typeof formMessages[0] === "string") {
    return formMessages[0];
  }
  for (const messages of Object.values(fieldErrors)) {
    if (Array.isArray(messages) && typeof messages[0] === "string") {
      return messages[0];
    }
  }
  return null;
}

function fallbackMessage(status: number, requestId: string | null): string {
  if (status >= 500) {
    return `Erro inesperado no servidor (${status}).${requestId ? ` Referência: ${requestId}` : ""}`;
  }
  return `Não foi possível concluir a ação (${status}).`;
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const requestId = response.headers?.get?.("x-vercel-id") ?? null;
    let message: string | null = null;
    let body: unknown = null;
    try {
      body = await response.json();
      if (body && typeof (body as { error?: unknown }).error === "string" && (body as { error: string }).error.trim()) {
        message = (body as { error: string }).error;
      } else {
        message = firstFieldErrorMessage(body);
      }
    } catch {
      // Response body wasn't JSON -- fall back to a readable message below.
    }
    throw new ApiError(response.status, message ?? fallbackMessage(response.status, requestId), body, requestId);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
