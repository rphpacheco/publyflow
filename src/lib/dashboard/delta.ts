export type DeltaKind = "count" | "money" | "rate" | "days";

export interface Delta {
  label: string | null;
  direction: "up" | "down" | "flat" | null;
  tone: "good" | "bad" | "neutral";
}

const NONE: Delta = { label: null, direction: null, tone: "neutral" };

/** Spec D10: rates in percentage points, everything else in percent of the previous value. */
export function computeDelta(current: number | null, previous: number | null, kind: DeltaKind, higherIsBetter: boolean): Delta {
  if (current === null || previous === null) return NONE;
  let amount: number;
  let label: string;
  if (kind === "rate") {
    amount = Math.round((current - previous) * 100);
    label = `${Math.abs(amount)} p.p.`;
  } else {
    if (previous === 0) return NONE;
    amount = Math.round(((current - previous) / previous) * 100);
    label = `${Math.abs(amount)}%`;
  }
  if (amount === 0) return { label, direction: "flat", tone: "neutral" };
  const direction = amount > 0 ? "up" : "down";
  const good = (direction === "up") === higherIsBetter;
  return { label, direction, tone: good ? "good" : "bad" };
}
