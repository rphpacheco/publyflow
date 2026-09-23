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

  it("falls back to statusText when the error body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new Error("not json");
        },
      }),
    );

    await expect(apiFetch("/api/example")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });
});
