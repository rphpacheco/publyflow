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
