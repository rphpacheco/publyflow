import { describe, it, expect, vi, afterEach } from "vitest";
import { createJevService } from "./jev-provider";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetch(response: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("createJevService", () => {
  it("asks the systemone endpoint a choice question over the message categories", async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: async () => ({
        model: "jev-latest",
        answers: {
          category: {
            type: "choice",
            choice: "COMMERCIAL_LEAD",
            confidence: 0.9,
            probabilities: { COMMERCIAL_LEAD: 0.94, FAN: 0.03, OTHER: 0.03 },
          },
        },
        usage: { input_tokens: 120, output_tokens: 4 },
      }),
    });

    await createJevService("test-key").classifyIntent({
      body: "Olá, gostaríamos de saber os valores para uma campanha.",
      source: "INSTAGRAM",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers.authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("jev-latest");
    expect(body.state).toBe("Origem: INSTAGRAM\nMensagem: Olá, gostaríamos de saber os valores para uma campanha.");
    expect(body.questions.category.type).toBe("choice");
    expect(Object.keys(body.questions.category.criteria)).toEqual([
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

  it("maps the choice to the category and the commercial-lead probability to the score", async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        answers: {
          category: {
            type: "choice",
            choice: "FAN",
            confidence: 0.95,
            probabilities: { FAN: 0.95, COMMERCIAL_LEAD: 0.024, OTHER: 0.026 },
          },
        },
      }),
    });

    const result = await createJevService("test-key").classifyIntent({ body: "Te amo!", source: "INSTAGRAM" });

    expect(result).toEqual({ category: "FAN", commercialScore: 2, intent: null });
  });

  it("scores 0 when the commercial-lead probability is absent", async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        answers: { category: { type: "choice", choice: "SPAM", confidence: 0.99, probabilities: { SPAM: 0.99 } } },
      }),
    });

    const result = await createJevService("test-key").classifyIntent({ body: "ganhe dinheiro", source: "INSTAGRAM" });

    expect(result.commercialScore).toBe(0);
  });

  it("throws when the Jev API responds with a non-ok status", async () => {
    mockFetch({ ok: false, status: 401 });

    await expect(
      createJevService("test-key").classifyIntent({ body: "qualquer coisa", source: "INSTAGRAM" }),
    ).rejects.toThrow("Jev classification failed with status 401");
  });
});
