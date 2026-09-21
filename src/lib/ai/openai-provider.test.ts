import { describe, it, expect, vi } from "vitest";
import { createOpenAIService } from "./openai-provider";

vi.mock("openai", () => {
  return {
    default: class OpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    companyName: "Bella Cosméticos",
                    brandName: null,
                    contactName: "Maria",
                    email: null,
                    phone: null,
                    budget: null,
                    deliverables: null,
                  }),
                },
              },
            ],
          }),
        },
      };
    },
  };
});

describe("createOpenAIService", () => {
  it("extracts structured fields and never invents unknown data", async () => {
    const service = createOpenAIService("test-key");

    const result = await service.extractLeadData({
      body: "Olá, gostaríamos de saber os valores para uma campanha.",
      source: "INSTAGRAM",
    });

    expect(result.companyName).toBe("Bella Cosméticos");
    expect(result.contactName).toBe("Maria");
    expect(result.budget).toBeNull();
  });
});
