import { describe, it, expect, vi, afterEach } from "vitest";
import { NextResponse } from "next/server";
import { unauthorizedResponse, authUnavailableResponse } from "./http";

describe("unauthorizedResponse", () => {
  it("returns 401 with a Portuguese error body", async () => {
    const response = unauthorizedResponse();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Não autenticado" });
  });
});

describe("authUnavailableResponse", () => {
  it("returns 503 AUTH_UNAVAILABLE", async () => {
    const response = authUnavailableResponse();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Serviço de autenticação indisponível. Tente novamente em instantes.",
      code: "AUTH_UNAVAILABLE",
    });
  });
});

async function importWithGetSession(getSession: () => Promise<unknown>) {
  vi.resetModules();
  vi.doMock("./session", () => ({ getSession }));
  return import("./http");
}

describe("getRouteSession", () => {
  afterEach(() => {
    vi.doUnmock("./session");
    vi.resetModules();
  });

  it("returns the session when there is one", async () => {
    const session = { userId: "u1", organizationId: "o1", role: "OWNER", creatorId: null };
    const { getRouteSession } = await importWithGetSession(async () => session);
    expect(await getRouteSession()).toEqual(session);
  });

  it("answers 401 without a session", async () => {
    const { getRouteSession } = await importWithGetSession(async () => null);
    const result = await getRouteSession();
    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Não autenticado" });
  });

  it("answers 503 AUTH_UNAVAILABLE when the auth provider is unavailable", async () => {
    const { getRouteSession } = await importWithGetSession(async () => {
      // Same module instance http.ts sees (registry was reset before import).
      const { AuthUnavailableError } = await import("./errors");
      throw new AuthUnavailableError();
    });
    const result = await getRouteSession();
    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Serviço de autenticação indisponível. Tente novamente em instantes.",
      code: "AUTH_UNAVAILABLE",
    });
  });

  it("rethrows any other error", async () => {
    const boom = new Error("boom");
    const { getRouteSession } = await importWithGetSession(async () => {
      throw boom;
    });
    await expect(getRouteSession()).rejects.toBe(boom);
  });
});
