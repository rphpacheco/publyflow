import { describe, it, expect } from "vitest";
import { unauthorizedResponse } from "./http";

describe("unauthorizedResponse", () => {
  it("returns 401 with a Portuguese error body", async () => {
    const response = unauthorizedResponse();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Não autenticado" });
  });
});
