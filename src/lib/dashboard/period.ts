import { z } from "zod";

export const DASHBOARD_TZ = "America/Sao_Paulo";
export type Period = { from: string; to: string };
export type Preset = "this_month" | "last_month" | "last_90_days" | "this_year";
export type Bucket = "day" | "week" | "month";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function utcOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function isRealDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function addDays(date: string, days: number): string {
  return new Date(utcOf(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysInclusive(period: Period): number {
  return Math.round((utcOf(period.to) - utcOf(period.from)) / DAY_MS) + 1;
}

export function toLocalDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DASHBOARD_TZ }).format(instant);
}

// Offset (minutes) of DASHBOARD_TZ at an instant, from Intl — no hardcoded -03:00.
function offsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - instant.getTime()) / 60_000;
}

export function localMidnightUtc(date: string): Date {
  const guess = new Date(utcOf(date));
  return new Date(guess.getTime() - offsetMinutes(guess) * 60_000);
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function resolvePreset(preset: Preset, now: Date): Period {
  const today = toLocalDate(now);
  switch (preset) {
    case "this_month":
      return { from: monthStart(today), to: monthEnd(today) };
    case "last_month": {
      const lastDayPrev = addDays(monthStart(today), -1);
      return { from: monthStart(lastDayPrev), to: lastDayPrev };
    }
    case "last_90_days":
      return { from: addDays(today, -89), to: today };
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}

export function periodBounds(period: Period): { start: Date; endExclusive: Date } {
  return { start: localMidnightUtc(period.from), endExclusive: localMidnightUtc(addDays(period.to, 1)) };
}

export function previousPeriod(period: Period): Period {
  const wholeMonth = period.from === monthStart(period.from) && period.to === monthEnd(period.from);
  if (wholeMonth) {
    const lastDayPrev = addDays(period.from, -1);
    return { from: monthStart(lastDayPrev), to: lastDayPrev };
  }
  const year = period.from.slice(0, 4);
  if (period.from === `${year}-01-01` && period.to === `${year}-12-31`) {
    const prev = String(Number(year) - 1);
    return { from: `${prev}-01-01`, to: `${prev}-12-31` };
  }
  const length = daysInclusive(period);
  const to = addDays(period.from, -1);
  return { from: addDays(to, -(length - 1)), to };
}

export function bucketFor(period: Period): Bucket {
  const days = daysInclusive(period);
  if (days <= 31) return "day";
  if (days <= 180) return "week";
  return "month";
}

export function bucketKey(date: string, bucket: Bucket): string {
  if (bucket === "day") return date;
  if (bucket === "month") return monthStart(date);
  const weekday = new Date(utcOf(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

export function bucketStarts(period: Period, bucket: Bucket): string[] {
  const starts: string[] = [];
  let cursor = bucketKey(period.from, bucket);
  while (cursor <= period.to) {
    starts.push(cursor);
    cursor = bucket === "day" ? addDays(cursor, 1) : bucket === "week" ? addDays(cursor, 7) : addDays(monthEnd(cursor), 1);
  }
  return starts;
}

const dateField = (missing: string) =>
  z.string({ error: missing }).min(1, missing).refine(isRealDate, "Data inválida.");

export const periodQuerySchema = z
  .object({ from: dateField("Informe a data inicial."), to: dateField("Informe a data final.") })
  .superRefine((value, ctx) => {
    if (!isRealDate(value.from) || !isRealDate(value.to)) return;
    if (value.to < value.from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "A data final deve ser igual ou posterior à inicial." });
      return;
    }
    const [y, m, d] = value.from.split("-").map(Number);
    const limit = new Date(Date.UTC(y + 2, m - 1, d)).toISOString().slice(0, 10);
    if (value.to > limit) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "O período máximo é de 2 anos." });
    }
  });
