import { describe, it, expect } from "vitest";
import {
  addDays, bucketFor, bucketKey, bucketStarts, comparisonPeriod, daysInclusive, localMidnightUtc,
  periodBounds, periodQuerySchema, previousPeriod, resolvePreset, toLocalDate,
} from "./period";

describe("time zone helpers", () => {
  it("2026-10-01 00:30 UTC is still September 30 in São Paulo", () => {
    expect(toLocalDate(new Date("2026-10-01T00:30:00Z"))).toBe("2026-09-30");
  });
  it("local midnight is 03:00 UTC (no DST)", () => {
    expect(localMidnightUtc("2026-10-01").toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
  it("adds days across month/year turns", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("presets", () => {
  const now = new Date("2026-10-05T15:00:00Z");
  it("this_month is the whole calendar month", () => {
    expect(resolvePreset("this_month", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("last_month", () => {
    expect(resolvePreset("last_month", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("last_90_days ends today", () => {
    expect(resolvePreset("last_90_days", now)).toEqual({ from: "2026-07-08", to: "2026-10-05" });
  });
  it("this_year", () => {
    expect(resolvePreset("this_year", now)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
  it("uses the São Paulo date, not UTC", () => {
    expect(resolvePreset("this_month", new Date("2026-11-01T01:00:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("bounds and previous period", () => {
  it("bounds are local midnights, end exclusive", () => {
    const b = periodBounds({ from: "2026-10-01", to: "2026-10-31" });
    expect(b.start.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(b.endExclusive.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
  it("whole month → whole previous month", () => {
    expect(previousPeriod({ from: "2026-10-01", to: "2026-10-31" })).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("whole year → previous year", () => {
    expect(previousPeriod({ from: "2026-01-01", to: "2026-12-31" })).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
  it("free range → same length right before", () => {
    expect(previousPeriod({ from: "2026-10-11", to: "2026-10-20" })).toEqual({ from: "2026-10-01", to: "2026-10-10" });
    expect(daysInclusive({ from: "2026-10-11", to: "2026-10-20" })).toBe(10);
  });
});

describe("comparisonPeriod", () => {
  it("running month → same elapsed span of the previous month", () => {
    expect(comparisonPeriod({ from: "2026-10-01", to: "2026-10-31" }, "2026-10-05")).toEqual({ from: "2026-09-01", to: "2026-09-05" });
  });
  it("running year → same span of the previous year", () => {
    expect(comparisonPeriod({ from: "2026-01-01", to: "2026-12-31" }, "2026-10-05")).toEqual({ from: "2025-01-01", to: "2025-10-05" });
  });
  it("today on the last day → period not running, full previous period", () => {
    expect(comparisonPeriod({ from: "2026-03-01", to: "2026-03-31" }, "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("span longer than the previous period is clamped to its end", () => {
    expect(comparisonPeriod({ from: "2026-03-01", to: "2026-03-31" }, "2026-03-30")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("past period → unchanged previousPeriod", () => {
    const past = { from: "2026-09-01", to: "2026-09-30" };
    expect(comparisonPeriod(past, "2026-10-05")).toEqual(previousPeriod(past));
    const range = { from: "2026-08-11", to: "2026-08-20" };
    expect(comparisonPeriod(range, "2026-10-05")).toEqual(previousPeriod(range));
  });
});

describe("buckets", () => {
  it("chooses day/week/month by length", () => {
    expect(bucketFor({ from: "2026-10-01", to: "2026-10-31" })).toBe("day");
    expect(bucketFor({ from: "2026-07-08", to: "2026-10-05" })).toBe("week");
    expect(bucketFor({ from: "2026-01-01", to: "2026-12-31" })).toBe("month");
  });
  it("week buckets start on Monday", () => {
    expect(bucketKey("2026-10-07", "week")).toBe("2026-10-05"); // Wednesday → Monday
    expect(bucketKey("2026-10-05", "week")).toBe("2026-10-05");
    expect(bucketKey("2026-10-04", "week")).toBe("2026-09-28"); // Sunday → previous Monday
  });
  it("month bucket key", () => {
    expect(bucketKey("2026-10-17", "month")).toBe("2026-10-01");
  });
  it("lists every bucket start of the period", () => {
    expect(bucketStarts({ from: "2026-10-01", to: "2026-10-03" }, "day")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(bucketStarts({ from: "2026-01-15", to: "2026-03-02" }, "month")).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(bucketStarts({ from: "2026-10-07", to: "2026-10-19" }, "week")).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
  });
});

describe("periodQuerySchema", () => {
  const messages = (input: unknown) => {
    const r = periodQuerySchema.safeParse(input);
    return r.success ? null : r.error.issues.map((i) => i.message);
  };
  it("accepts a valid range", () => {
    expect(periodQuerySchema.parse({ from: "2026-10-01", to: "2026-10-31" })).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("requires both dates", () => {
    expect(messages({ to: "2026-10-31" })).toContain("Informe a data inicial.");
    expect(messages({ from: "2026-10-01" })).toContain("Informe a data final.");
  });
  it("rejects invalid dates", () => {
    expect(messages({ from: "2026-02-30", to: "2026-03-01" })).toContain("Data inválida.");
    expect(messages({ from: "01/10/2026", to: "2026-10-31" })).toContain("Data inválida.");
  });
  it("rejects to before from and ranges over 2 years", () => {
    expect(messages({ from: "2026-10-31", to: "2026-10-01" })).toContain("A data final deve ser igual ou posterior à inicial.");
    expect(messages({ from: "2024-01-01", to: "2026-01-02" })).toContain("O período máximo é de 2 anos.");
  });
});
