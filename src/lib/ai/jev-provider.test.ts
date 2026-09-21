import { describe, it, expect, vi, afterEach } from "vitest";
import { createJevService } from "./jev-provider";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("createJevService", () => {
  it("classifies category, commercial score, and intent from a typed decision response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        decision: "COMMERCIAL_LEAD",
        confidence: 0.94,
        metadata: { intent: "Pedido de mídia kit" },
      }),
    }) as unknown as typeof fetch;

    const service = createJevService("test-key");

    const result = await service.classifyIntent({
      body: "Olá, gostaríamos de saber os valores para uma campanha.",
      source: "INSTAGRAM",
    });

    expect(result.category).toBe("COMMERCIAL_LEAD");
    expect(result.commercialScore).toBe(94);
    expect(result.intent).toBe("Pedido de mídia kit");
  });

  it("throws when the Jev API responds with a non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

    const service = createJevService("test-key");

    await expect(
      service.classifyIntent({ body: "qualquer coisa", source: "INSTAGRAM" }),
    ).rejects.toThrow("Jev classification failed");
  });
});
