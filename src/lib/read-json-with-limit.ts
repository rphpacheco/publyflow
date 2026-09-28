export const MAX_PUBLIC_BODY_BYTES = 16384;

export class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

/** Cheap pre-check on the declared size; the header can be absent or lie, so reading still caps. */
export function declaredLengthExceeds(request: Request, maxBytes: number): boolean {
  const declared = Number(request.headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
}

/** Reads at most `maxBytes` of the body; null for an empty body or invalid JSON. */
export async function readJsonWithLimit(request: Request, maxBytes: number): Promise<unknown | null> {
  if (declaredLengthExceeds(request, maxBytes)) throw new PayloadTooLargeError(maxBytes);
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
