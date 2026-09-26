import { describe, it, expect } from "vitest";
import { presentResponse } from "./present-response";
import { formatDateTime } from "./format";

describe("presentResponse / formatDateTime", () => {
  it("formats the response date and keeps the message", () => {
    expect(
      presentResponse({ action: "REQUEST_CHANGES", respondentName: "Maria", respondedAt: new Date("2026-09-25T17:32:00Z"), message: "Trocar stories" }),
    ).toEqual({ action: "REQUEST_CHANGES", respondentName: "Maria", respondedAtLabel: "25 de setembro de 2026", message: "Trocar stories" });
  });

  it("formats date and time in São Paulo", () => {
    expect(formatDateTime(new Date("2026-09-25T17:32:00Z"))).toBe("25/09/2026, 14:32");
  });
});
