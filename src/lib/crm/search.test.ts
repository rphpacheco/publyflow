import { describe, it, expect } from "vitest";
import { matchesSearch, normalizeSearch } from "./search";

describe("search", () => {
  it("normalizes accents, case and spaces", () => {
    expect(normalizeSearch("  Bella COSMÉTICOS ")).toBe("bella cosmeticos");
  });
  it("matches any field and ignores null fields", () => {
    expect(matchesSearch("cosme", "Bella Cosméticos", null)).toBe(true);
    expect(matchesSearch("@maria", "Maria", null, "@maria.f")).toBe(true);
    expect(matchesSearch("zzz", "Bella", undefined)).toBe(false);
  });
  it("empty query matches everything", () => {
    expect(matchesSearch("  ", "anything")).toBe(true);
  });
});
