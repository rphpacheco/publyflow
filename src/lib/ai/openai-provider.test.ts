import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => {
  return {
    default: class OpenAI {
      chat = { completions: { create: createMock } };
    },
  };
});

import { createOpenAIService } from "./openai-provider";

function respondWith(content: unknown) {
  createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(content) } }] });
}

const input = { body: "Olá, gostaríamos de saber os valores para uma campanha.", source: "INSTAGRAM" };

describe("createOpenAIService", () => {
  beforeEach(() => createMock.mockReset());

  it("extracts structured fields and never invents unknown data", async () => {
    respondWith({
      companyName: "Bella Cosméticos",
      brandName: null,
      contactName: "Maria",
      email: null,
      phone: null,
      budget: null,
      deliverables: null,
    });

    const result = await createOpenAIService("test-key").extractLeadData(input);

    expect(result.companyName).toBe("Bella Cosméticos");
    expect(result.contactName).toBe("Maria");
    expect(result.budget).toBeNull();
  });

  it("requests extraction with a strict JSON schema naming every field", async () => {
    respondWith({
      companyName: null,
      brandName: null,
      contactName: null,
      email: null,
      phone: null,
      budget: null,
      deliverables: null,
    });

    await createOpenAIService("test-key").extractLeadData(input);

    const format = createMock.mock.calls[0][0].response_format;
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.required).toEqual([
      "companyName",
      "brandName",
      "contactName",
      "email",
      "phone",
      "budget",
      "deliverables",
    ]);
  });

  it("classifies intent with a strict JSON schema restricted to the message categories", async () => {
    respondWith({ category: "COMMERCIAL_LEAD", commercialScore: 88, intent: "Pedido de proposta" });

    const result = await createOpenAIService("test-key").classifyIntent(input);

    expect(result).toEqual({ category: "COMMERCIAL_LEAD", commercialScore: 88, intent: "Pedido de proposta" });
    const format = createMock.mock.calls[0][0].response_format;
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.properties.category.enum).toEqual([
      "FAN",
      "COMMERCIAL_LEAD",
      "EXISTING_CLIENT",
      "AGENCY",
      "PRESS",
      "PARTNERSHIP",
      "SPAM",
      "OTHER",
    ]);
  });
});
