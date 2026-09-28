// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PayloadTooLargeError, declaredLengthExceeds, readJsonWithLimit } from "./read-json-with-limit";

function streamOf(text: string, chunkSize = 1024) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);

describe("declaredLengthExceeds", () => {
  it("is true only when Content-Length is above the cap", () => {
    expect(declaredLengthExceeds(post("{}", { "content-length": "20000" }), 16384)).toBe(true);
    expect(declaredLengthExceeds(post("{}", { "content-length": "16384" }), 16384)).toBe(false);
    expect(declaredLengthExceeds(post(streamOf("{}")), 16384)).toBe(false);
  });
});

describe("readJsonWithLimit", () => {
  it("parses JSON within the cap, including multi-byte characters", async () => {
    expect(await readJsonWithLimit(post(streamOf(JSON.stringify({ message: "ação 😀" }), 3)), 16384)).toEqual({
      message: "ação 😀",
    });
  });

  it("throws when the streamed body passes the cap without Content-Length", async () => {
    await expect(readJsonWithLimit(post(streamOf("x".repeat(20000))), 16384)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("throws on a declared Content-Length above the cap without reading", async () => {
    await expect(
      readJsonWithLimit(post("{}", { "content-length": "20000" }), 16384),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("returns null for invalid JSON or an empty body", async () => {
    expect(await readJsonWithLimit(post(streamOf("{not json")), 16384)).toBeNull();
    expect(await readJsonWithLimit(new Request("http://localhost/x", { method: "POST" }), 16384)).toBeNull();
  });
});
