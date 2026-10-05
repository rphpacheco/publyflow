import { describe, it, expect } from "vitest";
import { resolveValueCents, snapshotTotalCents } from "./value";

const snapshot = (items: Array<{ quantity: number; unitPrice: number }>) => ({
  proposal: { title: "T", status: "SENT", theme: "PREMIUM" },
  items: items.map((i, n) => ({ description: `i${n}`, sortOrder: n, ...i })),
  blocks: [],
});

describe("snapshotTotalCents", () => {
  it("sums quantity × unitPrice", () => {
    expect(snapshotTotalCents(snapshot([{ quantity: 2, unitPrice: 50000 }, { quantity: 1, unitPrice: 10000 }]))).toBe(110000);
  });
  it("returns null for an invalid snapshot", () => {
    expect(snapshotTotalCents({ nope: true })).toBeNull();
  });
  it("returns null for a snapshot with no items (falls back to the estimate)", () => {
    expect(snapshotTotalCents(snapshot([]))).toBeNull();
    expect(resolveValueCents({ preferredCents: snapshotTotalCents(snapshot([])), estimatedValueCents: 90000 })).toBe(90000);
  });
  it("returns 0 when items exist but sum to zero", () => {
    expect(snapshotTotalCents(snapshot([{ quantity: 1, unitPrice: 0 }]))).toBe(0);
  });
});

describe("resolveValueCents", () => {
  it("prefers the proposal value, then the estimate, then 0", () => {
    expect(resolveValueCents({ preferredCents: 110000, estimatedValueCents: 90000 })).toBe(110000);
    expect(resolveValueCents({ preferredCents: null, estimatedValueCents: 90000 })).toBe(90000);
    expect(resolveValueCents({ preferredCents: null, estimatedValueCents: null })).toBe(0);
  });
  it("a zero-value proposal still wins over the estimate", () => {
    expect(resolveValueCents({ preferredCents: 0, estimatedValueCents: 90000 })).toBe(0);
  });
});
