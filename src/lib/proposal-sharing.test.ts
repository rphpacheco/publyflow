import { describe, it, expect } from "vitest";
import { CLOSED_STAGES, RESPONSE_STAGE, RESPONSE_STATUS, SENT_STAGE, isPublicTokenFormat, publicPathFor } from "./proposal-sharing";

describe("proposal sharing vocabulary", () => {
  it("validates the token format", () => {
    expect(isPublicTokenFormat("A".repeat(43))).toBe(true);
    expect(isPublicTokenFormat("a-_".repeat(14) + "z")).toBe(true);
    expect(isPublicTokenFormat("A".repeat(42))).toBe(false);
    expect(isPublicTokenFormat("A".repeat(42) + "=")).toBe(false);
    expect(publicPathFor("abc")).toBe("/p/abc");
  });

  it("maps responses to statuses and pipeline stages", () => {
    expect(RESPONSE_STATUS).toEqual({ ACCEPT: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED", REJECT: "REJECTED" });
    expect(RESPONSE_STAGE).toEqual({ ACCEPT: "FECHADO", REQUEST_CHANGES: "NEGOCIACAO", REJECT: "PERDIDO" });
    expect(SENT_STAGE).toBe("PROPOSTA_ENVIADA");
    expect([...CLOSED_STAGES].sort()).toEqual(["FECHADO", "PERDIDO"]);
  });
});
