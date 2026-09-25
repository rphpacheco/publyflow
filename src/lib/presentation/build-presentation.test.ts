import { describe, it, expect } from "vitest";
import { buildPresentation } from "./build-presentation";
import { formatBRL, formatIssuedAt } from "./format";
import type { PresentationContext, PresentationSnapshotInput } from "./types";

const context: PresentationContext = {
  creator: { displayName: "Thais", instagramHandle: "@thais" },
  client: { name: "Bella Cosméticos" },
  issuedAt: new Date("2026-09-25T15:00:00Z"),
};

function snapshot(overrides: Partial<PresentationSnapshotInput> = {}): PresentationSnapshotInput {
  return {
    proposal: { title: "Campanha Verão", theme: "EDITORIAL", status: "DRAFT" },
    items: [
      { description: "Stories", quantity: 2, unitPrice: 80000, sortOrder: 1 },
      { description: "Reel patrocinado", quantity: 3, unitPrice: 250000, sortOrder: 0 },
    ],
    blocks: [
      { blockType: "COVER", content: { headline: "Verão com Bella" } },
      { blockType: "TEXT", content: { body: "Uma campanha de lançamento." } },
    ],
    ...overrides,
  };
}

describe("formatBRL / formatIssuedAt", () => {
  it("formats cents as BRL with a regular space", () => {
    expect(formatBRL(250000)).toBe("R$ 2.500,00");
    expect(formatBRL(0)).toBe("R$ 0,00");
    expect(formatBRL(12345678)).toBe("R$ 123.456,78");
  });

  it("formats the issue date in pt-BR, São Paulo time", () => {
    expect(formatIssuedAt(new Date("2026-09-25T15:00:00Z"))).toBe("25 de setembro de 2026");
    // 02:00 UTC on the 26th is still the 25th in São Paulo (UTC-3)
    expect(formatIssuedAt(new Date("2026-09-26T02:00:00Z"))).toBe("25 de setembro de 2026");
  });
});

describe("buildPresentation", () => {
  it("builds the model with items sorted, subtotals and total", () => {
    const model = buildPresentation(snapshot(), context);

    expect(model.theme).toBe("EDITORIAL");
    expect(model.title).toBe("Campanha Verão");
    expect(model.headline).toBe("Verão com Bella");
    expect(model.body).toBe("Uma campanha de lançamento.");
    expect(model.creator).toEqual({ name: "Thais", handle: "@thais" });
    expect(model.clientName).toBe("Bella Cosméticos");
    expect(model.items.map((item) => item.description)).toEqual(["Reel patrocinado", "Stories"]);
    expect(model.items[0]).toEqual({
      description: "Reel patrocinado",
      quantity: 3,
      unitPriceCents: 250000,
      subtotalCents: 750000,
      unitPriceLabel: "R$ 2.500,00",
      subtotalLabel: "R$ 7.500,00",
    });
    expect(model.totalCents).toBe(910000);
    expect(model.totalLabel).toBe("R$ 9.100,00");
    expect(model.issuedAtLabel).toBe("25 de setembro de 2026");
  });

  it("falls back to the title when the headline is empty", () => {
    const model = buildPresentation(
      snapshot({ blocks: [{ blockType: "COVER", content: { headline: "   " } }] }),
      context,
    );
    expect(model.headline).toBe("Campanha Verão");
  });

  it("returns a null body when the text block is empty or missing", () => {
    expect(buildPresentation(snapshot({ blocks: [{ blockType: "TEXT", content: { body: "" } }] }), context).body).toBeNull();
    expect(buildPresentation(snapshot({ blocks: [] }), context).body).toBeNull();
  });

  it("returns no items and a zero total when there are no items", () => {
    const model = buildPresentation(snapshot({ items: [] }), context);
    expect(model.items).toEqual([]);
    expect(model.totalCents).toBe(0);
    expect(model.totalLabel).toBe("R$ 0,00");
  });

  it("normalizes the creator handle and omits it when absent", () => {
    const bare = buildPresentation(snapshot(), { ...context, creator: { displayName: "Thais", instagramHandle: "thais" } });
    expect(bare.creator.handle).toBe("@thais");
    const none = buildPresentation(snapshot(), { ...context, creator: { displayName: "Thais", instagramHandle: null } });
    expect(none.creator.handle).toBeNull();
    const blank = buildPresentation(snapshot(), { ...context, creator: { displayName: "Thais", instagramHandle: " @ " } });
    expect(blank.creator.handle).toBeNull();
  });

  it("passes the client name through and turns a blank one into null", () => {
    expect(buildPresentation(snapshot(), { ...context, client: { name: null } }).clientName).toBeNull();
    expect(buildPresentation(snapshot(), { ...context, client: { name: "  " } }).clientName).toBeNull();
  });

  it("reads the theme from legacy snapshots that still carry `template`", () => {
    const model = buildPresentation(
      snapshot({ proposal: { title: "Antiga", template: "FASHION", status: "DRAFT" } }),
      context,
    );
    expect(model.theme).toBe("FASHION");
  });

  it("falls back to MINIMAL for an unknown or missing theme", () => {
    expect(buildPresentation(snapshot({ proposal: { title: "X", theme: "NEON", status: "DRAFT" } }), context).theme).toBe("MINIMAL");
    expect(buildPresentation(snapshot({ proposal: { title: "X", status: "DRAFT" } }), context).theme).toBe("MINIMAL");
  });

  it("is deterministic: the same input gives the same output", () => {
    expect(buildPresentation(snapshot(), context)).toEqual(buildPresentation(snapshot(), context));
  });
});
