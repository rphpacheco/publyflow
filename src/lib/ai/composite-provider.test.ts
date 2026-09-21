import { describe, it, expect } from "vitest";
import { createCompositeAIService } from "./composite-provider";

describe("createCompositeAIService", () => {
  it("merges Jev's classification with OpenAI's extraction into one MessageClassification", async () => {
    const jev = {
      classifyIntent: async () => ({
        category: "COMMERCIAL_LEAD" as const,
        commercialScore: 94,
        intent: "Pedido de mídia kit",
      }),
    };
    const openai = {
      extractLeadData: async () => ({
        companyName: "Bella Cosméticos",
        brandName: null,
        contactName: "Maria",
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      }),
    };

    const service = createCompositeAIService({ jev, openai });

    const result = await service.classifyMessage({
      body: "Olá, gostaríamos de saber os valores para uma campanha.",
      source: "INSTAGRAM",
    });

    expect(result.category).toBe("COMMERCIAL_LEAD");
    expect(result.commercialScore).toBe(94);
    expect(result.intent).toBe("Pedido de mídia kit");
    expect(result.extracted.companyName).toBe("Bella Cosméticos");
  });
});
