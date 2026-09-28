import { describe, it, expect, vi, afterEach } from "vitest";
import { createCompositeAIService } from "./composite-provider";

const input = { body: "Olá, gostaríamos de saber os valores para uma campanha.", source: "INSTAGRAM" };

const extracted = {
  companyName: "Bella Cosméticos",
  brandName: null,
  contactName: "Maria",
  email: null,
  phone: null,
  budget: null,
  deliverables: null,
};

function openaiDouble() {
  return {
    extractLeadData: vi.fn(async () => extracted),
    classifyIntent: vi.fn(async () => ({
      category: "COMMERCIAL_LEAD" as const,
      commercialScore: 80,
      intent: "Pedido de proposta",
    })),
  };
}

describe("createCompositeAIService", () => {
  afterEach(() => vi.restoreAllMocks());

  it("merges Jev's classification with OpenAI's extraction into one MessageClassification", async () => {
    const jev = {
      classifyIntent: async () => ({
        category: "COMMERCIAL_LEAD" as const,
        commercialScore: 94,
        intent: null,
      }),
    };
    const openai = openaiDouble();

    const result = await createCompositeAIService({ jev, openai }).classifyMessage(input);

    expect(result.category).toBe("COMMERCIAL_LEAD");
    expect(result.commercialScore).toBe(94);
    expect(result.extracted.companyName).toBe("Bella Cosméticos");
    expect(openai.classifyIntent).not.toHaveBeenCalled();
  });

  it("falls back to OpenAI's classification when Jev fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const jev = {
      classifyIntent: async () => {
        throw new Error("Jev classification failed with status 401");
      },
    };
    const openai = openaiDouble();

    const result = await createCompositeAIService({ jev, openai }).classifyMessage(input);

    expect(result.category).toBe("COMMERCIAL_LEAD");
    expect(result.commercialScore).toBe(80);
    expect(result.intent).toBe("Pedido de proposta");
    expect(openai.classifyIntent).toHaveBeenCalledWith(input);
    expect(warn).toHaveBeenCalledWith(
      "Jev classification failed; falling back to OpenAI",
      expect.any(Error),
    );
  });

  it("fails when both providers fail to classify", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const jev = {
      classifyIntent: async () => {
        throw new Error("jev down");
      },
    };
    const openai = openaiDouble();
    openai.classifyIntent.mockRejectedValueOnce(new Error("openai down"));

    await expect(createCompositeAIService({ jev, openai }).classifyMessage(input)).rejects.toThrow("openai down");
  });
});
