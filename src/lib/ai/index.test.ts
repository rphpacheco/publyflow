import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const KEYS = ["OPENAI_API_KEY", "JEV_API_KEY"] as const;

describe("@/lib/ai", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.resetModules();
  });

  it("imports without API keys and rejects with AiNotConfiguredError on use", async () => {
    const { ai } = await import("@/lib/ai");
    const { AiNotConfiguredError } = await import("@/lib/ai/errors");

    await expect(ai.classifyMessage({ body: "Olá", source: "INSTAGRAM" })).rejects.toBeInstanceOf(
      AiNotConfiguredError,
    );
  });
});
