import { describe, it, expect } from "vitest";
import { computeDelta } from "./delta";

describe("computeDelta", () => {
  it("percent for counts and money", () => {
    expect(computeDelta(118, 100, "money", true)).toEqual({ label: "18%", direction: "up", tone: "good" });
    expect(computeDelta(80, 100, "count", true)).toEqual({ label: "20%", direction: "down", tone: "bad" });
  });
  it("percentage points for rates", () => {
    expect(computeDelta(0.74, 0.7, "rate", true)).toEqual({ label: "4 p.p.", direction: "up", tone: "good" });
  });
  it("inverted tone when lower is better", () => {
    expect(computeDelta(5, 3, "count", false).tone).toBe("bad");
    expect(computeDelta(12.5, 18.4, "days", false)).toMatchObject({ direction: "down", tone: "good" });
  });
  it("flat", () => {
    expect(computeDelta(10, 10, "count", true)).toEqual({ label: "0%", direction: "flat", tone: "neutral" });
  });
  it("no comparison when previous is 0 or a value is null", () => {
    expect(computeDelta(5, 0, "count", true)).toEqual({ label: null, direction: null, tone: "neutral" });
    expect(computeDelta(null, 0.5, "rate", true)).toEqual({ label: null, direction: null, tone: "neutral" });
    expect(computeDelta(0.5, null, "rate", true)).toEqual({ label: null, direction: null, tone: "neutral" });
  });
});
