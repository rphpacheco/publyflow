import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch, ApiError } from "./api-client";

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed JSON on a 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "abc" }),
      }),
    );

    const result = await apiFetch<{ id: string }>("/api/example");
    expect(result).toEqual({ id: "abc" });
  });

  it("resolves to undefined on a 204 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 204 }),
    );

    const result = await apiFetch("/api/example");
    expect(result).toBeUndefined();
  });

  it("throws ApiError with the response status and error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({ error: "Multiple companies match" }),
      }),
    );

    await expect(apiFetch("/api/example")).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      message: "Multiple companies match",
    });
  });

  it("falls back to a readable message when the error body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers(),
        json: async () => {
          throw new Error("not json");
        },
      }),
    );

    await expect(apiFetch("/api/example")).rejects.toMatchObject({
      status: 500,
      message: "Erro inesperado no servidor (500).",
    });
  });

  it("keeps the parsed error body on ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: { email: ["Informe um e-mail válido."] } }), { status: 400 }),
    );
    const error = (await apiFetch("/x").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.body).toEqual({ errors: { email: ["Informe um e-mail válido."] } });
  });

  it("5xx without a JSON error: generic message plus the Vercel request reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "",
        headers: new Headers({ "x-vercel-id": "gru1::iad1::abc123" }),
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      }),
    );
    const error = await apiFetch("/api/example").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("Erro inesperado no servidor (500). Referência: gru1::iad1::abc123");
    expect((error as ApiError).requestId).toBe("gru1::iad1::abc123");
  });

  it("5xx without a JSON error and without the header: no reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "",
        headers: new Headers(),
        json: async () => ({}),
      }),
    );
    const error = (await apiFetch("/api/example").catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("Erro inesperado no servidor (502).");
    expect(error.requestId).toBeNull();
  });

  it("400 with a field errors object (no top-level error string): uses the first field message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: new Headers(),
        json: async () => ({ errors: { companyName: ["Use no máximo 200 caracteres."] } }),
      }),
    );
    const error = (await apiFetch("/api/example").catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("Use no máximo 200 caracteres.");
  });

  it("400 with a form-level errors entry: uses that message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: new Headers(),
        json: async () => ({ errors: { form: ["Informe ao menos um campo."] } }),
      }),
    );
    const error = (await apiFetch("/api/example").catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("Informe ao menos um campo.");
  });

  it("4xx without a JSON error: 'Não foi possível concluir a ação'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "",
        headers: new Headers(),
        json: async () => {
          throw new SyntaxError("not json");
        },
      }),
    );
    const error = (await apiFetch("/api/example").catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("Não foi possível concluir a ação (404).");
  });
});
