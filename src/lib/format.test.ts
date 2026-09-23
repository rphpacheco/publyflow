import { describe, it, expect } from "vitest";
import { relativeTime, formatCurrencyBRL } from "./format";

describe("relativeTime", () => {
  it("formats a timestamp from a few minutes ago", () => {
    const iso = new Date(Date.now() - 5 * 60000).toISOString();
    expect(relativeTime(iso)).toBe("há 5min");
  });

  it("formats a timestamp from a few hours ago", () => {
    const iso = new Date(Date.now() - 3 * 3600000).toISOString();
    expect(relativeTime(iso)).toBe("há 3h");
  });
});

describe("formatCurrencyBRL", () => {
  it("formats cents as a BRL currency string", () => {
    expect(formatCurrencyBRL(500000)).toBe("R$ 5.000,00");
  });

  it("formats zero cents", () => {
    expect(formatCurrencyBRL(0)).toBe("R$ 0,00");
  });
});
