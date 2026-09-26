import { describe, it, expect } from "vitest";
import { parsePresentationSnapshot, parsePublicationContext, toPublicationContextJson } from "./snapshot-schema";

const stored = {
  proposal: { title: "Campanha", theme: "EDITORIAL", status: "DRAFT" },
  items: [{ id: "i1", description: "Reel", quantity: 3, unitPrice: 250000, sortOrder: 0, createdAt: "2026-09-25T15:00:00.000Z" }],
  blocks: [{ id: "b1", blockType: "COVER", content: { headline: "Verão" }, sortOrder: 0 }],
};

describe("parsePresentationSnapshot", () => {
  it("keeps only what the presentation needs", () => {
    expect(parsePresentationSnapshot(stored)).toEqual({
      proposal: { title: "Campanha", theme: "EDITORIAL", status: "DRAFT" },
      items: [{ description: "Reel", quantity: 3, unitPrice: 250000, sortOrder: 0 }],
      blocks: [{ blockType: "COVER", content: { headline: "Verão" } }],
    });
  });

  it("accepts legacy snapshots that carry `template`", () => {
    const legacy = { ...stored, proposal: { title: "Antiga", template: "FASHION", status: "DRAFT" } };
    expect(parsePresentationSnapshot(legacy).proposal).toEqual({ title: "Antiga", template: "FASHION", status: "DRAFT" });
  });

  it("throws on corrupted data", () => {
    expect(() => parsePresentationSnapshot({ proposal: { title: 1 }, items: [], blocks: [] })).toThrow();
    expect(() => parsePresentationSnapshot(null)).toThrow();
  });
});

describe("publication context", () => {
  it("round-trips through JSON with issuedAt normalized to a Date", () => {
    const json = toPublicationContextJson(
      { creator: { displayName: "Thais", instagramHandle: "@thais" }, clientName: "Bella" },
      new Date("2026-09-25T15:00:00Z"),
    );
    expect(json).toEqual({
      creator: { displayName: "Thais", instagramHandle: "@thais" },
      clientName: "Bella",
      issuedAt: "2026-09-25T15:00:00.000Z",
    });
    const parsed = parsePublicationContext(JSON.parse(JSON.stringify(json)));
    expect(parsed.issuedAt).toBeInstanceOf(Date);
    expect(parsed.issuedAt.toISOString()).toBe("2026-09-25T15:00:00.000Z");
    expect(parsed.clientName).toBe("Bella");
  });

  it("throws on corrupted context", () => {
    expect(() => parsePublicationContext({ creator: {}, clientName: null, issuedAt: "ontem" })).toThrow();
  });
});
