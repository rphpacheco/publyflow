# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 404 at `/dashboard` with an OWNER/MANAGER page showing Comercial metrics (with previous-period deltas and a won-over-time chart), the current pipeline, a per-creator table, and Requer ação / Acompanhamento counts — and fix opportunity `status` not returning to `OPEN` when an opportunity is reopened.

**Architecture:** Pure modules (`period`, `value`, `delta`) hold the rules; `DashboardRepository` returns per-opportunity rows and small aggregates (always org-scoped, optional `creatorScope`); `DashboardService` composes current + previous period, values and the zero-filled series; `DashboardActionsService` counts `ProposalQueueService.list` situations. Two GET routes, TanStack Query hooks, client page with two independently loading columns.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query, Drizzle + Postgres, zod 4, recharts 3 (new), lucide-react, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-05-dashboard-design.md`

## Global Constraints

- Every query and join carries an explicit `organization_id` predicate and runs inside `runInTenantContext` (the app role bypasses RLS). Every repository method takes `creatorScope: string | null` and, when non-null, restricts to `opportunities.creator_id` / `commercial_inquiries.creator_id` / `creators.id` = scope.
- Access: session (401) → `canManageOrganization(session.role)` (CREATOR → 403) → zod (400 `{ errors: z.flattenError(err).fieldErrors }`). Never raw exception text. Postgres 40P01 → 409 via `src/lib/db-errors.ts`.
- Time zone: **America/Sao_Paulo** for every period boundary and chart bucket. `from`/`to` are inclusive `YYYY-MM-DD`.
- Period messages (verbatim): "Informe a data inicial." · "Informe a data final." · "Data inválida." · "A data final deve ser igual ou posterior à inicial." · "O período máximo é de 2 anos."
- Won/lost (D5): most recent entry into `FECHADO`/`PERDIDO` in `opportunity_stage_history.changed_at` inside the period **and** current `status` `WON`/`LOST`.
- Money (D6): won = Σ(quantity × unitPrice) of the snapshot of the most recent publication (by `published_at`) whose response action is `ACCEPT` → else `estimated_value_cents` → else 0. Open = current items total of the most recent (by `created_at`) non-archived proposal → else estimated → else 0.
- **No emoji or symbol glyphs in the UI** (no 📅 ✓ ▲ ▼). Icons only from **lucide-react**: `CalendarRange` (De/até), `ArrowUpRight` / `ArrowDownRight` / `Minus` (deltas), `CircleCheck` ("Tudo em dia"), `LayoutDashboard` already in the sidebar.
- UI copy in Portuguese, exactly as in the spec.
- Tests: `/opt/homebrew/bin/pnpm vitest run <files> --testTimeout=60000 --hookTimeout=60000`. Never two vitest processes at once. Never run the full suite from the repo root while a worktree exists — use `--dir src`. Subagents only run tests: never `drizzle-kit migrate`, never docker, never touch dev/prod databases (generating a migration file with `drizzle-kit generate --custom` is allowed — it does not touch any database).
- Commit after each task; message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
|---|---|
| `src/repositories/opportunities.repository.ts` (modify) | `updateStage` resets status to OPEN on non-terminal stages |
| `src/db/migrations/0022_reopen_opportunity_status.sql` (+ meta) (create via drizzle-kit) | data-only backfill |
| `src/lib/dashboard/period.ts` | presets, bounds, previous period, buckets, query schema |
| `src/lib/dashboard/value.ts` | snapshot total + value resolution |
| `src/lib/dashboard/delta.ts` | delta label/tone/direction |
| `src/repositories/dashboard.repository.ts` | SQL reads |
| `src/services/dashboard.service.ts` | metrics composition |
| `src/services/dashboard-actions.service.ts` | action counts |
| `src/app/api/dashboard/metrics/route.ts`, `src/app/api/dashboard/actions/route.ts` | HTTP |
| `src/hooks/use-dashboard.ts` | queries |
| `src/components/dashboard/*` | KPI card, chart, pipeline card, creators table, actions panel, period picker |
| `src/app/(app)/dashboard/page.tsx` | page |

---

### Task 1: Reopened opportunities return to OPEN (code + data migration)

**Files:**
- Modify: `src/repositories/opportunities.repository.ts` (the stage-update helper around lines 85-112: `statusUpdate`)
- Test: `src/repositories/opportunities.repository.test.ts`
- Create (generated): `src/db/migrations/0022_reopen_opportunity_status.sql`, `src/db/migrations/meta/0022_snapshot.json`, journal entry

**Interfaces:** Produces: `updateStage`/`updateStageWithTx` now set `status: "OPEN"` when `newStage` is neither `FECHADO` nor `PERDIDO`.

- [ ] **Step 1: Write the failing test** — append to `src/repositories/opportunities.repository.test.ts` (reuse the file's existing setup helpers/fixtures used by the test "updateStage changes the opportunity's stage and records a stage_history row in one transaction"; read that test first and build the opportunity the same way):

```ts
it("updateStage returns status to OPEN when an opportunity leaves FECHADO or PERDIDO", async () => {
  // arrange exactly like the existing updateStage test, producing `db`, `organizationId`, `opportunity`
  const won = await OpportunitiesRepository.updateStage(db, organizationId, opportunity.id, "FECHADO");
  expect(won.status).toBe("WON");
  const reopened = await OpportunitiesRepository.updateStage(db, organizationId, opportunity.id, "NEGOCIACAO");
  expect(reopened.status).toBe("OPEN");
  const lost = await OpportunitiesRepository.updateStage(db, organizationId, opportunity.id, "PERDIDO");
  expect(lost.status).toBe("LOST");
  const reopenedAgain = await OpportunitiesRepository.updateStage(db, organizationId, opportunity.id, "QUALIFICACAO");
  expect(reopenedAgain.status).toBe("OPEN");
});
```
Check the real `updateStage` signature in the file (arguments and return) and adapt the calls if it differs — keep the assertions.

- [ ] **Step 2: Run — expect FAIL** (`reopened.status` is `"WON"`): `pnpm vitest run src/repositories/opportunities.repository.test.ts --testTimeout=60000 --hookTimeout=60000`

- [ ] **Step 3: Implement** — replace the status branch:
```ts
  // Stage is the source of truth: leaving a terminal stage reopens the deal.
  const statusUpdate: Partial<typeof opportunities.$inferInsert> = {
    status: newStage === "FECHADO" ? "WON" : newStage === "PERDIDO" ? "LOST" : "OPEN",
  };
```

- [ ] **Step 4: Generate the data migration** (no database touched):
```bash
/opt/homebrew/bin/pnpm drizzle-kit generate --custom --name reopen_opportunity_status
```
Fill the generated `src/db/migrations/0022_reopen_opportunity_status.sql` with:
```sql
-- Data-only: opportunities reopened before the updateStage fix kept status WON/LOST.
UPDATE "opportunities"
SET "status" = 'OPEN'
WHERE "stage" NOT IN ('FECHADO', 'PERDIDO')
  AND "status" <> 'OPEN';
```
Confirm `meta/_journal.json` gained entry idx 22 with tag `0022_reopen_opportunity_status`.

- [ ] **Step 5: Run — expect PASS** (same command as Step 2). Also run `pnpm vitest run src/services/opportunity.service.test.ts src/app/api/opportunities --testTimeout=60000 --hookTimeout=60000` if those paths exist (stage-change consumers).

- [ ] **Step 6: Commit**
```bash
git add src/repositories/opportunities.repository.ts src/repositories/opportunities.repository.test.ts src/db/migrations
git commit -m "fix(opportunities): reopening a closed/lost opportunity returns status to OPEN (+ data backfill 0022)"
```

---

### Task 2: Pure modules — period, value, delta

**Files:**
- Create: `src/lib/dashboard/period.ts`, `src/lib/dashboard/value.ts`, `src/lib/dashboard/delta.ts`
- Test: `src/lib/dashboard/period.test.ts`, `src/lib/dashboard/value.test.ts`, `src/lib/dashboard/delta.test.ts`

**Interfaces (Produces):**
```ts
// period.ts
export const DASHBOARD_TZ = "America/Sao_Paulo";
export type Period = { from: string; to: string };           // inclusive YYYY-MM-DD
export type Preset = "this_month" | "last_month" | "last_90_days" | "this_year";
export type Bucket = "day" | "week" | "month";
export function toLocalDate(instant: Date): string;
export function localMidnightUtc(date: string): Date;
export function addDays(date: string, days: number): string;
export function daysInclusive(period: Period): number;
export function resolvePreset(preset: Preset, now: Date): Period;
export function periodBounds(period: Period): { start: Date; endExclusive: Date };
export function previousPeriod(period: Period): Period;
export function bucketFor(period: Period): Bucket;
export function bucketKey(date: string, bucket: Bucket): string;  // start date of the bucket containing `date`
export function bucketStarts(period: Period, bucket: Bucket): string[];
export const periodQuerySchema: z.ZodType<Period>;
// value.ts
export function snapshotTotalCents(snapshotJson: unknown): number | null;
export function resolveValueCents(input: { preferredCents: number | null; estimatedValueCents: number | null }): number;
// delta.ts
export type DeltaKind = "count" | "money" | "rate" | "days";
export interface Delta { label: string | null; direction: "up" | "down" | "flat" | null; tone: "good" | "bad" | "neutral" }
export function computeDelta(current: number | null, previous: number | null, kind: DeltaKind, higherIsBetter: boolean): Delta;
```

- [ ] **Step 1: Write the failing tests**

`src/lib/dashboard/period.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  addDays, bucketFor, bucketKey, bucketStarts, daysInclusive, localMidnightUtc,
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
```

`src/lib/dashboard/value.test.ts`:
```ts
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
```

`src/lib/dashboard/delta.test.ts`:
```ts
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
```

- [ ] **Step 2: Run — expect FAIL**: `pnpm vitest run src/lib/dashboard`

- [ ] **Step 3: Implement**

`src/lib/dashboard/period.ts`:
```ts
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
```
(If zod 4 rejects `z.string({ error })` for a missing key in this project's version, use `z.string({ message: missing })` — the test asserts the message, keep it verbatim.)

`src/lib/dashboard/value.ts`:
```ts
import { parsePresentationSnapshot } from "@/lib/presentation/snapshot-schema";

/** Σ quantity × unitPrice of a stored version snapshot; null when the JSON is not a valid snapshot. */
export function snapshotTotalCents(snapshotJson: unknown): number | null {
  try {
    const snapshot = parsePresentationSnapshot(snapshotJson);
    return snapshot.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  } catch {
    return null;
  }
}

/** Spec D6: proposal value (accepted snapshot for won, current proposal for open) → estimate → 0. */
export function resolveValueCents(input: { preferredCents: number | null; estimatedValueCents: number | null }): number {
  return input.preferredCents ?? input.estimatedValueCents ?? 0;
}
```
(Check `PresentationSnapshotInput.items` exposes `quantity`/`unitPrice`; it does in `src/lib/presentation/snapshot-schema.ts`.)

`src/lib/dashboard/delta.ts`:
```ts
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
```

- [ ] **Step 4: Run — expect PASS**: `pnpm vitest run src/lib/dashboard`

- [ ] **Step 5: Commit**
```bash
git add src/lib/dashboard
git commit -m "feat(dashboard): period, value and delta rules"
```

---

### Task 3: `DashboardRepository` (SQL reads)

**Files:**
- Create: `src/repositories/dashboard.repository.ts`, `src/test/helpers/inquiry-fixtures.ts` (`seedInquiry`)
- Test: `src/repositories/dashboard.repository.test.ts`

**Interfaces:**
- Consumes: `Period`/`periodBounds` from Task 2 (callers pass bounds), schema tables.
- Produces (every method: `(tx: Db, organizationId: string, …, creatorScope: string | null)`; call them inside a caller-owned `runInTenantContext`):
```ts
export interface Bounds { start: Date; endExclusive: Date }
export interface ClosedOpportunityRow { id: string; creatorId: string; createdAt: Date; closedAt: Date; estimatedValueCents: number | null }
export interface OpenOpportunityRow { id: string; creatorId: string; stage: OpportunityStage; estimatedValueCents: number | null }
export const DashboardRepository: {
  inquiryCounts(tx, orgId, bounds: Bounds, scope): Promise<{ received: number; converted: number }>;
  opportunitiesCreatedCount(tx, orgId, bounds: Bounds, scope): Promise<number>;
  closedOpportunities(tx, orgId, bounds: Bounds, terminal: "FECHADO" | "PERDIDO", scope): Promise<ClosedOpportunityRow[]>;
  openOpportunities(tx, orgId, scope): Promise<OpenOpportunityRow[]>;
  acceptedSnapshots(tx, orgId, opportunityIds: string[]): Promise<Map<string, unknown>>;      // opportunityId → snapshot_json of most recent ACCEPTed publication
  currentProposalTotals(tx, orgId, opportunityIds: string[]): Promise<Map<string, number>>;   // opportunityId → Σ items of most recent non-archived proposal
  creators(tx, orgId, scope): Promise<Array<{ id: string; name: string }>>;
  proposalsSentByCreator(tx, orgId, bounds: Bounds, scope): Promise<Map<string, number>>;
  clientResponsesByCreator(tx, orgId, bounds: Bounds, scope): Promise<Map<string, { accepts: number; rejects: number }>>;
}
```

- [ ] **Step 1: Write the failing test** `src/repositories/dashboard.repository.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { commercialInquiries, conversations, messages, opportunityStageHistory } from "@/db/schema";
import { proposalItems } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";
import { OpportunitiesRepository } from "./opportunities.repository";
import { ProposalSendingService } from "@/services/proposal-sending.service";
import { ProposalResponseService } from "@/services/proposal-response.service";
import { DashboardRepository } from "./dashboard.repository";

const OCT = { start: new Date("2026-10-01T03:00:00Z"), endExclusive: new Date("2026-11-01T03:00:00Z") };

type Db = Parameters<typeof runInTenantContext>[0];

async function setHistoryDate(db: Db, opportunityId: string, at: string) {
  await db.update(opportunityStageHistory).set({ changedAt: new Date(at) })
    .where(eq(opportunityStageHistory.opportunityId, opportunityId));
}

// Shared by Tasks 3-5 tests: conversation → message → commercial_inquiry with a given status/createdAt.
export async function seedInquiry(db: Db, organizationId: string, creatorId: string, status: "NEW" | "CONVERTED" | "DISCARDED", createdAt: string) {
  const [conversation] = await db.insert(conversations)
    .values({ organizationId, creatorId, source: "INSTAGRAM", externalContactLabel: "@cliente" }).returning();
  const [message] = await db.insert(messages)
    .values({ organizationId, conversationId: conversation.id, body: "Oi, quero uma proposta", receivedAt: new Date(createdAt) }).returning();
  await db.insert(commercialInquiries)
    .values({ organizationId, creatorId, messageId: message.id, status, createdAt: new Date(createdAt) });
}

describe("DashboardRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db); // other org
    const read = <T>(fn: (tx: typeof db) => Promise<T>) => runInTenantContext(db, a.organization.id, fn);
    return { db, a, b, read };
  }

  it("closedOpportunities uses the most recent FECHADO entry and the current WON status", async () => {
    const { db, a, read } = await setup();
    const id = a.opportunity.id;
    await OpportunitiesRepository.updateStage(db, a.organization.id, id, "FECHADO");
    await setHistoryDate(db, id, "2026-10-10T12:00:00Z");
    let rows = await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", null));
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(rows[0].closedAt.toISOString()).toBe("2026-10-10T12:00:00.000Z");

    await OpportunitiesRepository.updateStage(db, a.organization.id, id, "NEGOCIACAO"); // reopened → status OPEN
    rows = await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", null));
    expect(rows).toEqual([]);
  });

  it("closed outside the period is not returned; scope filters by creator", async () => {
    const { db, a, read } = await setup();
    await OpportunitiesRepository.updateStage(db, a.organization.id, a.opportunity.id, "FECHADO");
    await setHistoryDate(db, a.opportunity.id, "2026-09-30T23:00:00Z"); // 20:00 SP on Sep 30
    expect(await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", null))).toEqual([]);
    await setHistoryDate(db, a.opportunity.id, "2026-10-02T12:00:00Z");
    expect(await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", "00000000-0000-4000-8000-000000000099"))).toEqual([]);
    expect(await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", a.creator.id))).toHaveLength(1);
  });

  it("openOpportunities and currentProposalTotals", async () => {
    const { db, a, read } = await setup();
    await db.insert(proposalItems).values({ organizationId: a.organization.id, proposalId: a.proposal.id, description: "Reels", quantity: 2, unitPrice: 50000 });
    const open = await read((tx) => DashboardRepository.openOpportunities(tx, a.organization.id, null));
    expect(open.map((o) => o.id)).toEqual([a.opportunity.id]);
    const totals = await read((tx) => DashboardRepository.currentProposalTotals(tx, a.organization.id, [a.opportunity.id]));
    expect(totals.get(a.opportunity.id)).toBeGreaterThanOrEqual(100000);
  });

  it("acceptedSnapshots returns the snapshot of the accepted publication", async () => {
    const { db, a, read } = await setup();
    await db.insert(proposalItems).values({ organizationId: a.organization.id, proposalId: a.proposal.id, description: "Reels", quantity: 1, unitPrice: 70000 });
    const { publication, publicPath } = await ProposalSendingService.publish(db, a.organization.id, a.proposal.id, a.owner.id);
    const token = publicPath.split("/").pop()!;
    await ProposalResponseService.respond(db, token, { publicationId: publication.id, action: "ACCEPT", name: "Cliente", email: "c@x.com", message: null });
    const snapshots = await read((tx) => DashboardRepository.acceptedSnapshots(tx, a.organization.id, [a.opportunity.id]));
    expect(snapshots.has(a.opportunity.id)).toBe(true);
  });

  it("creators, proposals sent and client responses by creator", async () => {
    const { db, a, read } = await setup();
    const { publication, publicPath } = await ProposalSendingService.publish(db, a.organization.id, a.proposal.id, a.owner.id);
    const token = publicPath.split("/").pop()!;
    await ProposalResponseService.respond(db, token, { publicationId: publication.id, action: "REJECT", name: "Cliente", email: "c@x.com", message: null });
    const wide = { start: new Date("2000-01-01T00:00:00Z"), endExclusive: new Date("2100-01-01T00:00:00Z") };
    expect(await read((tx) => DashboardRepository.creators(tx, a.organization.id, null))).toEqual([{ id: a.creator.id, name: "Thais" }]);
    expect((await read((tx) => DashboardRepository.proposalsSentByCreator(tx, a.organization.id, wide, null))).get(a.creator.id)).toBe(1);
    expect((await read((tx) => DashboardRepository.clientResponsesByCreator(tx, a.organization.id, wide, null))).get(a.creator.id)).toEqual({ accepts: 0, rejects: 1 });
  });

  it("inquiryCounts and opportunitiesCreatedCount respect period, org and scope", async () => {
    const { db, a, b, read } = await setup();
    const wide = { start: new Date("2000-01-01T00:00:00Z"), endExclusive: new Date("2100-01-01T00:00:00Z") };
    expect(await read((tx) => DashboardRepository.opportunitiesCreatedCount(tx, a.organization.id, wide, null))).toBe(1);
    expect(await read((tx) => DashboardRepository.opportunitiesCreatedCount(tx, a.organization.id, OCT, null))).toBe(
      a.opportunity.createdAt >= OCT.start && a.opportunity.createdAt < OCT.endExclusive ? 1 : 0,
    );
    await seedInquiry(db, a.organization.id, a.creator.id, "CONVERTED", "2026-10-02T12:00:00Z");
    await seedInquiry(db, a.organization.id, a.creator.id, "NEW", "2026-10-03T12:00:00Z");
    await seedInquiry(db, a.organization.id, a.creator.id, "CONVERTED", "2026-09-30T23:30:00Z"); // 20:30 SP, September
    await seedInquiry(db, b.organization.id, b.creator.id, "CONVERTED", "2026-10-02T12:00:00Z"); // other org
    expect(await read((tx) => DashboardRepository.inquiryCounts(tx, a.organization.id, OCT, null))).toEqual({ received: 2, converted: 1 });
    expect(await read((tx) => DashboardRepository.inquiryCounts(tx, a.organization.id, OCT, "00000000-0000-4000-8000-000000000099"))).toEqual({ received: 0, converted: 0 });
  });
});
```
Notes for the implementer: (1) `seedProposal` creates org + owner + creator "Thais" + company + contact + lead + opportunity + proposal. Move `seedInquiry` into `src/test/helpers/inquiry-fixtures.ts` (exported) so Tasks 4-5 can reuse it. (2) `ProposalSendingService.publish` must succeed for the seeded proposal (the seeded creator has no CREATOR membership, so no approval is required); if it requires a version first, follow `src/services/proposal-sending.service.test.ts`. (3) Remove `setHistoryDate`'s unused `toStage` param if lint complains.

- [ ] **Step 2: Run — expect FAIL**: `pnpm vitest run src/repositories/dashboard.repository.test.ts --testTimeout=60000 --hookTimeout=60000`

- [ ] **Step 3: Implement `src/repositories/dashboard.repository.ts`**
```ts
import { and, count, desc, eq, gte, inArray, lt, max, ne, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { commercialInquiries, opportunities, opportunityStageHistory } from "@/db/schema/commercial-flow";
import { proposalItems, proposalPublications, proposalResponses, proposals, proposalVersions } from "@/db/schema/proposals";
import { creators } from "@/db/schema/creators";
import type { OpportunityStage } from "@/lib/opportunity-stages";

type Db = NodePgDatabase<typeof schema>;
export interface Bounds { start: Date; endExclusive: Date }
export interface ClosedOpportunityRow { id: string; creatorId: string; createdAt: Date; closedAt: Date; estimatedValueCents: number | null }
export interface OpenOpportunityRow { id: string; creatorId: string; stage: OpportunityStage; estimatedValueCents: number | null }

const scoped = (column: SQL | typeof opportunities.creatorId | typeof commercialInquiries.creatorId | typeof creators.id, scope: string | null) =>
  scope === null ? undefined : eq(column as typeof opportunities.creatorId, scope);

export const DashboardRepository = {
  async inquiryCounts(tx: Db, organizationId: string, bounds: Bounds, scope: string | null) {
    const [row] = await tx
      .select({
        received: count(),
        converted: sql<number>`count(*) filter (where ${commercialInquiries.status} = 'CONVERTED')`.mapWith(Number),
      })
      .from(commercialInquiries)
      .where(and(
        eq(commercialInquiries.organizationId, organizationId),
        gte(commercialInquiries.createdAt, bounds.start),
        lt(commercialInquiries.createdAt, bounds.endExclusive),
        scoped(commercialInquiries.creatorId, scope),
      ));
    return { received: Number(row.received), converted: Number(row.converted) };
  },

  async opportunitiesCreatedCount(tx: Db, organizationId: string, bounds: Bounds, scope: string | null) {
    const [row] = await tx
      .select({ n: count() })
      .from(opportunities)
      .where(and(
        eq(opportunities.organizationId, organizationId),
        gte(opportunities.createdAt, bounds.start),
        lt(opportunities.createdAt, bounds.endExclusive),
        scoped(opportunities.creatorId, scope),
      ));
    return Number(row.n);
  },

  // Spec D5: most recent entry into the terminal stage inside the period AND current status matches.
  async closedOpportunities(tx: Db, organizationId: string, bounds: Bounds, terminal: "FECHADO" | "PERDIDO", scope: string | null): Promise<ClosedOpportunityRow[]> {
    const lastEntry = tx
      .select({
        opportunityId: opportunityStageHistory.opportunityId,
        closedAt: max(opportunityStageHistory.changedAt).as("closed_at"),
      })
      .from(opportunityStageHistory)
      .where(and(eq(opportunityStageHistory.organizationId, organizationId), eq(opportunityStageHistory.toStage, terminal)))
      .groupBy(opportunityStageHistory.opportunityId)
      .as("last_entry");
    const rows = await tx
      .select({
        id: opportunities.id,
        creatorId: opportunities.creatorId,
        createdAt: opportunities.createdAt,
        estimatedValueCents: opportunities.estimatedValueCents,
        closedAt: lastEntry.closedAt,
      })
      .from(opportunities)
      .innerJoin(lastEntry, eq(lastEntry.opportunityId, opportunities.id))
      .where(and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.status, terminal === "FECHADO" ? "WON" : "LOST"),
        gte(lastEntry.closedAt, bounds.start),
        lt(lastEntry.closedAt, bounds.endExclusive),
        scoped(opportunities.creatorId, scope),
      ));
    return rows.map((row) => ({ ...row, closedAt: new Date(row.closedAt as unknown as string) }));
  },

  async openOpportunities(tx: Db, organizationId: string, scope: string | null): Promise<OpenOpportunityRow[]> {
    return tx
      .select({ id: opportunities.id, creatorId: opportunities.creatorId, stage: opportunities.stage, estimatedValueCents: opportunities.estimatedValueCents })
      .from(opportunities)
      .where(and(eq(opportunities.organizationId, organizationId), eq(opportunities.status, "OPEN"), scoped(opportunities.creatorId, scope)));
  },

  async acceptedSnapshots(tx: Db, organizationId: string, opportunityIds: string[]): Promise<Map<string, unknown>> {
    if (opportunityIds.length === 0) return new Map();
    const rows = await tx
      .select({ opportunityId: proposals.opportunityId, snapshot: proposalVersions.snapshotJson })
      .from(proposalResponses)
      .innerJoin(proposalPublications, and(eq(proposalPublications.id, proposalResponses.publicationId), eq(proposalPublications.organizationId, organizationId)))
      .innerJoin(proposals, and(eq(proposals.id, proposalPublications.proposalId), eq(proposals.organizationId, organizationId)))
      .innerJoin(proposalVersions, and(eq(proposalVersions.id, proposalPublications.versionId), eq(proposalVersions.organizationId, organizationId)))
      .where(and(eq(proposalResponses.organizationId, organizationId), eq(proposalResponses.action, "ACCEPT"), inArray(proposals.opportunityId, opportunityIds)))
      .orderBy(desc(proposalPublications.publishedAt));
    const result = new Map<string, unknown>();
    for (const row of rows) if (!result.has(row.opportunityId)) result.set(row.opportunityId, row.snapshot);
    return result;
  },

  async currentProposalTotals(tx: Db, organizationId: string, opportunityIds: string[]): Promise<Map<string, number>> {
    if (opportunityIds.length === 0) return new Map();
    const rows = await tx
      .select({
        opportunityId: proposals.opportunityId,
        total: sql<number>`coalesce(sum(${proposalItems.quantity} * ${proposalItems.unitPrice}), 0)`.mapWith(Number),
      })
      .from(proposals)
      .leftJoin(proposalItems, and(eq(proposalItems.proposalId, proposals.id), eq(proposalItems.organizationId, organizationId)))
      .where(and(eq(proposals.organizationId, organizationId), ne(proposals.status, "ARCHIVED"), inArray(proposals.opportunityId, opportunityIds)))
      .groupBy(proposals.id, proposals.opportunityId, proposals.createdAt)
      .orderBy(desc(proposals.createdAt));
    const result = new Map<string, number>();
    for (const row of rows) if (!result.has(row.opportunityId)) result.set(row.opportunityId, Number(row.total));
    return result;
  },

  async creators(tx: Db, organizationId: string, scope: string | null) {
    return tx
      .select({ id: creators.id, name: creators.displayName })
      .from(creators)
      .where(and(eq(creators.organizationId, organizationId), scoped(creators.id, scope)))
      .orderBy(creators.displayName);
  },

  async proposalsSentByCreator(tx: Db, organizationId: string, bounds: Bounds, scope: string | null): Promise<Map<string, number>> {
    const rows = await tx
      .select({ creatorId: opportunities.creatorId, n: count() })
      .from(proposalPublications)
      .innerJoin(proposals, and(eq(proposals.id, proposalPublications.proposalId), eq(proposals.organizationId, organizationId)))
      .innerJoin(opportunities, and(eq(opportunities.id, proposals.opportunityId), eq(opportunities.organizationId, organizationId)))
      .where(and(
        eq(proposalPublications.organizationId, organizationId),
        gte(proposalPublications.publishedAt, bounds.start),
        lt(proposalPublications.publishedAt, bounds.endExclusive),
        scoped(opportunities.creatorId, scope),
      ))
      .groupBy(opportunities.creatorId);
    return new Map(rows.map((r) => [r.creatorId, Number(r.n)]));
  },

  async clientResponsesByCreator(tx: Db, organizationId: string, bounds: Bounds, scope: string | null) {
    const rows = await tx
      .select({
        creatorId: opportunities.creatorId,
        accepts: sql<number>`count(*) filter (where ${proposalResponses.action} = 'ACCEPT')`.mapWith(Number),
        rejects: sql<number>`count(*) filter (where ${proposalResponses.action} = 'REJECT')`.mapWith(Number),
      })
      .from(proposalResponses)
      .innerJoin(proposalPublications, and(eq(proposalPublications.id, proposalResponses.publicationId), eq(proposalPublications.organizationId, organizationId)))
      .innerJoin(proposals, and(eq(proposals.id, proposalPublications.proposalId), eq(proposals.organizationId, organizationId)))
      .innerJoin(opportunities, and(eq(opportunities.id, proposals.opportunityId), eq(opportunities.organizationId, organizationId)))
      .where(and(
        eq(proposalResponses.organizationId, organizationId),
        gte(proposalResponses.respondedAt, bounds.start),
        lt(proposalResponses.respondedAt, bounds.endExclusive),
        scoped(opportunities.creatorId, scope),
      ))
      .groupBy(opportunities.creatorId);
    return new Map(rows.map((r) => [r.creatorId, { accepts: Number(r.accepts), rejects: Number(r.rejects) }]));
  },
};
```
Simplify the `scoped` helper's typing if TypeScript complains (e.g. `(column: AnyPgColumn, scope) => scope === null ? undefined : eq(column, scope)` with `import type { AnyPgColumn } from "drizzle-orm/pg-core"`). Check `src/db/schema/index.ts` exports used in the test imports; adjust import paths to the real modules.

- [ ] **Step 4: Run — expect PASS** (Step 2 command).

- [ ] **Step 5: Commit**
```bash
git add src/repositories/dashboard.repository.ts src/repositories/dashboard.repository.test.ts
git commit -m "feat(dashboard): repository reads (closed/open opportunities, values, creators, inquiries)"
```

---

### Task 4: `DashboardService.getMetrics`

**Files:**
- Create: `src/services/dashboard.service.ts`
- Test: `src/services/dashboard.service.test.ts`

**Interfaces:**
- Consumes: Task 2 (`Period`, `periodBounds`, `previousPeriod`, `bucketFor`, `bucketKey`, `bucketStarts`, `toLocalDate`, `snapshotTotalCents`, `resolveValueCents`), Task 3 repository.
- Produces:
```ts
export interface PeriodMetrics {
  inquiriesReceived: number; inquiriesConverted: number; conversionRate: number | null;
  opportunitiesCreated: number;
  wonCount: number; wonCents: number; lostCount: number;
  winRate: number | null; averageTicketCents: number | null; averageDaysToClose: number | null;
}
export interface DashboardMetrics {
  period: Period; previousPeriod: Period;
  current: PeriodMetrics; previous: PeriodMetrics;
  series: { bucket: Bucket; points: Array<{ start: string; wonCents: number; wonCount: number }> };
  openNow: { count: number; valueCents: number };
  funnel: Array<{ stage: OpportunityStage; count: number }>;
  creators: Array<{ creatorId: string; name: string; openOpportunities: number; proposalsSent: number; wonCount: number; wonCents: number; approvalRate: number | null }>;
}
export const DashboardService: { getMetrics(db, organizationId: string, period: Period, options: { creatorScope: string | null }): Promise<DashboardMetrics> };
```
`funnel` = every stage of `STAGES` (from `@/lib/opportunity-stages`) except `FECHADO` and `PERDIDO`, in order, zeros included.

- [ ] **Step 1: Write the failing test** `src/services/dashboard.service.test.ts` — use `seedProposal`, `OpportunitiesRepository.updateStage`, direct updates of `opportunity_stage_history.changed_at` and `opportunities.created_at` to place events in time, and `ProposalSendingService.publish` + `ProposalResponseService.respond` (pattern from Task 3's test). Cases (one `it` each, asserting exact numbers):
  1. Won in October with an accepted snapshot of 70000 and estimate 90000 → `current.wonCents = 70000`, `wonCount = 1`, `averageTicketCents = 70000`.
  2. Won without acceptance → value = `estimatedValueCents` (set 90000 via update); with neither → 0.
  3. Opportunity created 2026-10-01T15:00Z and closed 2026-10-11T15:00Z → `averageDaysToClose = 10`.
  4. Won in October + lost in October → `winRate = 0.5`; nothing closed → `winRate = null`, `averageTicketCents = null`, `averageDaysToClose = null`.
  5. Previous period: a win in September with period October → `previous.wonCount = 1`, `current.wonCount = 0`, `previousPeriod = { from: "2026-09-01", to: "2026-09-30" }`.
  6. Series for October: 31 daily points, all zero except the closing day (local date in São Paulo) which has the won value and count 1.
  7. `openNow`/`funnel` ignore the period: an open opportunity created in 2025 counts in `openNow.count` and in its stage's funnel entry; `funnel` has no FECHADO/PERDIDO entries.
  8. Creators: the seeded creator appears even with zero activity (all zeros, `approvalRate: null`); after one ACCEPT and one REJECT response in the period (two proposals) → `approvalRate = 0.5`; a REQUEST_CHANGES response does not change it.
  9. Org isolation: a second `seedProposal` org with a won opportunity in October never changes org A's numbers.
  10. `creatorScope`: with scope = a random uuid every count is 0 and `creators` is empty; with scope = the seeded creator numbers equal the unscoped ones.

- [ ] **Step 2: Run — expect FAIL**: `pnpm vitest run src/services/dashboard.service.test.ts --testTimeout=60000 --hookTimeout=60000`

- [ ] **Step 3: Implement `src/services/dashboard.service.ts`**
```ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { DashboardRepository, type Bounds, type ClosedOpportunityRow } from "@/repositories/dashboard.repository";
import { STAGES, type OpportunityStage } from "@/lib/opportunity-stages";
import {
  bucketFor, bucketKey, bucketStarts, periodBounds, previousPeriod, toLocalDate, type Bucket, type Period,
} from "@/lib/dashboard/period";
import { resolveValueCents, snapshotTotalCents } from "@/lib/dashboard/value";

type Db = NodePgDatabase<typeof schema>;
const DAY_MS = 86_400_000;

export interface PeriodMetrics {
  inquiriesReceived: number; inquiriesConverted: number; conversionRate: number | null;
  opportunitiesCreated: number;
  wonCount: number; wonCents: number; lostCount: number;
  winRate: number | null; averageTicketCents: number | null; averageDaysToClose: number | null;
}

export interface DashboardMetrics {
  period: Period; previousPeriod: Period;
  current: PeriodMetrics; previous: PeriodMetrics;
  series: { bucket: Bucket; points: Array<{ start: string; wonCents: number; wonCount: number }> };
  openNow: { count: number; valueCents: number };
  funnel: Array<{ stage: OpportunityStage; count: number }>;
  creators: Array<{ creatorId: string; name: string; openOpportunities: number; proposalsSent: number; wonCount: number; wonCents: number; approvalRate: number | null }>;
}

const ratio = (numerator: number, denominator: number) => (denominator === 0 ? null : numerator / denominator);

async function wonWithValues(tx: Db, organizationId: string, won: ClosedOpportunityRow[]) {
  const snapshots = await DashboardRepository.acceptedSnapshots(tx, organizationId, won.map((w) => w.id));
  return won.map((row) => {
    const snapshot = snapshots.get(row.id);
    const accepted = snapshot === undefined ? null : snapshotTotalCents(snapshot);
    return { ...row, valueCents: resolveValueCents({ preferredCents: accepted, estimatedValueCents: row.estimatedValueCents }) };
  });
}

async function periodMetrics(tx: Db, organizationId: string, bounds: Bounds, scope: string | null) {
  const [inquiries, created, wonRows, lostRows] = await Promise.all([
    DashboardRepository.inquiryCounts(tx, organizationId, bounds, scope),
    DashboardRepository.opportunitiesCreatedCount(tx, organizationId, bounds, scope),
    DashboardRepository.closedOpportunities(tx, organizationId, bounds, "FECHADO", scope),
    DashboardRepository.closedOpportunities(tx, organizationId, bounds, "PERDIDO", scope),
  ]);
  const won = await wonWithValues(tx, organizationId, wonRows);
  const wonCents = won.reduce((sum, w) => sum + w.valueCents, 0);
  const days = won.map((w) => (w.closedAt.getTime() - w.createdAt.getTime()) / DAY_MS);
  const metrics: PeriodMetrics = {
    inquiriesReceived: inquiries.received,
    inquiriesConverted: inquiries.converted,
    conversionRate: ratio(inquiries.converted, inquiries.received),
    opportunitiesCreated: created,
    wonCount: won.length,
    wonCents,
    lostCount: lostRows.length,
    winRate: ratio(won.length, won.length + lostRows.length),
    averageTicketCents: won.length === 0 ? null : Math.round(wonCents / won.length),
    averageDaysToClose: days.length === 0 ? null : Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10,
  };
  return { metrics, won };
}

export const DashboardService = {
  async getMetrics(db: Db, organizationId: string, period: Period, options: { creatorScope: string | null }): Promise<DashboardMetrics> {
    const scope = options.creatorScope;
    const previous = previousPeriod(period);
    return runInTenantContext(db, organizationId, async (tx) => {
      const bounds = periodBounds(period);
      const [current, prev, open, creatorList, sent, responses] = await Promise.all([
        periodMetrics(tx, organizationId, bounds, scope),
        periodMetrics(tx, organizationId, periodBounds(previous), scope),
        DashboardRepository.openOpportunities(tx, organizationId, scope),
        DashboardRepository.creators(tx, organizationId, scope),
        DashboardRepository.proposalsSentByCreator(tx, organizationId, bounds, scope),
        DashboardRepository.clientResponsesByCreator(tx, organizationId, bounds, scope),
      ]);

      const totals = await DashboardRepository.currentProposalTotals(tx, organizationId, open.map((o) => o.id));
      const openValue = open.reduce(
        (sum, o) => sum + resolveValueCents({ preferredCents: totals.get(o.id) ?? null, estimatedValueCents: o.estimatedValueCents }),
        0,
      );

      const bucket = bucketFor(period);
      const points = new Map(bucketStarts(period, bucket).map((start) => [start, { start, wonCents: 0, wonCount: 0 }]));
      for (const w of current.won) {
        const point = points.get(bucketKey(toLocalDate(w.closedAt), bucket));
        if (point) {
          point.wonCents += w.valueCents;
          point.wonCount += 1;
        }
      }

      const funnel = STAGES.filter((s) => s !== "FECHADO" && s !== "PERDIDO").map((stage) => ({
        stage,
        count: open.filter((o) => o.stage === stage).length,
      }));

      const creators = creatorList
        .map((creator) => {
          const wonOfCreator = current.won.filter((w) => w.creatorId === creator.id);
          const r = responses.get(creator.id) ?? { accepts: 0, rejects: 0 };
          return {
            creatorId: creator.id,
            name: creator.name,
            openOpportunities: open.filter((o) => o.creatorId === creator.id).length,
            proposalsSent: sent.get(creator.id) ?? 0,
            wonCount: wonOfCreator.length,
            wonCents: wonOfCreator.reduce((sum, w) => sum + w.valueCents, 0),
            approvalRate: ratio(r.accepts, r.accepts + r.rejects),
          };
        })
        .sort((a, b) => b.wonCents - a.wonCents || a.name.localeCompare(b.name, "pt-BR"));

      return {
        period,
        previousPeriod: previous,
        current: current.metrics,
        previous: prev.metrics,
        series: { bucket, points: [...points.values()] },
        openNow: { count: open.length, valueCents: openValue },
        funnel,
        creators,
      };
    });
  },
};
```
Note: a single transaction runs the parallel `Promise.all` queries sequentially on one connection — that is expected and fine.

- [ ] **Step 4: Run — expect PASS** (Step 2 command).

- [ ] **Step 5: Commit**
```bash
git add src/services/dashboard.service.ts src/services/dashboard.service.test.ts
git commit -m "feat(dashboard): metrics service (current vs previous period, series, funnel, creators)"
```

---

### Task 5: `DashboardActionsService` + both API routes

**Files:**
- Create: `src/services/dashboard-actions.service.ts`, `src/app/api/dashboard/metrics/route.ts`, `src/app/api/dashboard/actions/route.ts`
- Test: `src/services/dashboard-actions.service.test.ts`, `src/app/api/dashboard/metrics/route.test.ts`, `src/app/api/dashboard/actions/route.test.ts`

**Interfaces:**
- Consumes: `ProposalQueueService.list(db, orgId, { creatorScope, includeArchived })` → `{ items: QueueItem[]; closedCount; truncated }` (`QueueItem.situation`, `QueueItem.changes?.by`); `DashboardService.getMetrics`; `periodQuerySchema`.
- Produces:
```ts
export interface DashboardActions {
  untriagedInquiries: number; clientChangesRequested: number; creatorChangesRequested: number;
  awaitingCreatorApproval: number; readyToSend: number; awaitingClient: number; truncated: boolean;
}
export const DashboardActionsService: { get(db, organizationId: string, options: { creatorScope: string | null }): Promise<DashboardActions> };
// HTTP: GET /api/dashboard/metrics?from&to → DashboardMetrics; GET /api/dashboard/actions → DashboardActions
```

- [ ] **Step 1: Write the failing tests**

`src/services/dashboard-actions.service.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalQueueService } from "./proposal-queue.service";
import { DashboardActionsService } from "./dashboard-actions.service";

describe("DashboardActionsService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("counts match the proposals queue for the same data", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    await seedProposal(db); // another org — must not count
    const queue = await ProposalQueueService.list(db, a.organization.id, { creatorScope: null, includeArchived: false });
    const actions = await DashboardActionsService.get(db, a.organization.id, { creatorScope: null });
    const by = (s: string) => queue.items.filter((i) => i.situation === s).length;
    expect(actions).toEqual({
      untriagedInquiries: 0,
      clientChangesRequested: queue.items.filter((i) => i.situation === "changes_requested" && i.changes?.by === "client").length,
      creatorChangesRequested: queue.items.filter((i) => i.situation === "changes_requested" && i.changes?.by === "creator").length,
      awaitingCreatorApproval: by("awaiting_creator"),
      readyToSend: by("ready_to_send"),
      awaitingClient: by("awaiting_client"),
      truncated: queue.truncated,
    });
  });
});
```
Extend with: one `NEW` inquiry for org A (`seedInquiry` from `@/test/helpers/inquiry-fixtures`) → `untriagedInquiries: 1`; a client REQUEST_CHANGES response (publish + respond) → `clientChangesRequested: 1`.

`src/app/api/dashboard/metrics/route.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { creatorSession, importRouteWithSession, ownerSession } from "@/test/helpers/route";

describe("GET /api/dashboard/metrics", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function call(session: "owner" | "creator" | "none", query: string) {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const s = await seedProposal(db);
    const value = session === "owner" ? ownerSession(s.organization.id, s.owner.id)
      : session === "creator" ? creatorSession(s.organization.id, s.owner.id, s.creator.id) : null;
    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: value });
    return GET(new Request(`http://localhost/api/dashboard/metrics${query}`));
  }

  it("returns the metrics shape", async () => {
    const response = await call("owner", "?from=2026-10-01&to=2026-10-31");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(json.previousPeriod).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(json.series.bucket).toBe("day");
    expect(json.series.points).toHaveLength(31);
    expect(Array.isArray(json.creators)).toBe(true);
  });

  it("400 with Portuguese messages", async () => {
    const missing = await call("owner", "?to=2026-10-31");
    expect(missing.status).toBe(400);
    expect((await missing.json()).errors.from).toEqual(["Informe a data inicial."]);
    const reversed = await call("owner", "?from=2026-10-31&to=2026-10-01");
    expect((await reversed.json()).errors.to).toEqual(["A data final deve ser igual ou posterior à inicial."]);
  });

  it("403 for CREATOR and 401 without session", async () => {
    expect((await call("creator", "?from=2026-10-01&to=2026-10-31")).status).toBe(403);
    expect((await call("none", "?from=2026-10-01&to=2026-10-31")).status).toBe(401);
  });
});
```
`src/app/api/dashboard/actions/route.test.ts`: same structure — 200 with all seven keys, 403 creator, 401 none.

- [ ] **Step 2: Run — expect FAIL**: `pnpm vitest run src/services/dashboard-actions.service.test.ts src/app/api/dashboard --testTimeout=60000 --hookTimeout=60000`

- [ ] **Step 3: Implement**

`src/services/dashboard-actions.service.ts`:
```ts
import { and, count, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { commercialInquiries } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalQueueService } from "./proposal-queue.service";

type Db = NodePgDatabase<typeof schema>;

export interface DashboardActions {
  untriagedInquiries: number;
  clientChangesRequested: number;
  creatorChangesRequested: number;
  awaitingCreatorApproval: number;
  readyToSend: number;
  awaitingClient: number;
  truncated: boolean;
}

export const DashboardActionsService = {
  // Reuses the /proposals queue classification so both screens always agree (spec D13).
  async get(db: Db, organizationId: string, options: { creatorScope: string | null }): Promise<DashboardActions> {
    const queue = await ProposalQueueService.list(db, organizationId, { creatorScope: options.creatorScope, includeArchived: false });
    const untriaged = await runInTenantContext(db, organizationId, async (tx) => {
      const conditions = [eq(commercialInquiries.organizationId, organizationId), eq(commercialInquiries.status, "NEW")];
      if (options.creatorScope !== null) conditions.push(eq(commercialInquiries.creatorId, options.creatorScope));
      const [row] = await tx.select({ n: count() }).from(commercialInquiries).where(and(...conditions));
      return Number(row.n);
    });
    const by = (situation: string) => queue.items.filter((item) => item.situation === situation);
    return {
      untriagedInquiries: untriaged,
      clientChangesRequested: by("changes_requested").filter((i) => i.changes?.by === "client").length,
      creatorChangesRequested: by("changes_requested").filter((i) => i.changes?.by === "creator").length,
      awaitingCreatorApproval: by("awaiting_creator").length,
      readyToSend: by("ready_to_send").length,
      awaitingClient: by("awaiting_client").length,
      truncated: queue.truncated,
    };
  },
};
```

`src/app/api/dashboard/metrics/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { getSession } from "@/lib/auth/session";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";
import { periodQuerySchema } from "@/lib/dashboard/period";
import { DashboardService } from "@/services/dashboard.service";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const params = new URL(request.url).searchParams;
  const parsed = periodQuerySchema.safeParse({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    // The dashboard is agency-only today; the scope parameter exists for a future creator view (spec D2).
    const metrics = await DashboardService.getMetrics(db, session.organizationId, parsed.data, { creatorScope: null });
    return NextResponse.json(metrics, { status: 200 });
  } catch (error) {
    if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
    throw error;
  }
}
```
`src/app/api/dashboard/actions/route.ts`: same guards, no params, `DashboardActionsService.get(db, session.organizationId, { creatorScope: null })`, same deadlock mapping.

- [ ] **Step 4: Run — expect PASS** (Step 2 command), plus `pnpm vitest run src/app/api/write-guard.test.ts src/app/api/id-guard.test.ts` (both must stay green; these routes are GET-only without `[id]`).

- [ ] **Step 5: Commit**
```bash
git add src/services/dashboard-actions.service.ts src/services/dashboard-actions.service.test.ts src/app/api/dashboard
git commit -m "feat(api): dashboard metrics and actions endpoints"
```

---

### Task 6: Hooks + recharts + dashboard components

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (add recharts)
- Create: `src/hooks/use-dashboard.ts`, `src/components/dashboard/kpi-card.tsx`, `won-chart.tsx`, `pipeline-card.tsx`, `creators-table.tsx`, `actions-panel.tsx`, `period-picker.tsx`
- Test: `src/hooks/use-dashboard.test.tsx`, `src/components/dashboard/kpi-card.test.tsx`, `actions-panel.test.tsx`, `period-picker.test.tsx`, `pipeline-card.test.tsx`, `creators-table.test.tsx`, `won-chart.test.tsx`

**Interfaces:**
- Consumes: HTTP shapes of Task 5 (DTOs mirror `DashboardMetrics`/`DashboardActions` with dates as strings), `computeDelta`, `resolvePreset`, `periodQuerySchema` (Task 2), `formatCurrencyBRL` (`@/lib/format`), `STAGE_LABELS` (`@/lib/opportunity-stages`), `Card` (`@/components/ui/card`), `Popover*` (`@/components/ui/popover`), `Button`, `Input`, `Table*`.
- Produces:
```ts
// use-dashboard.ts
export type DashboardMetricsDto = …; export type DashboardActionsDto = …;
export const dashboardQueryKey = ["dashboard"] as const;
export function useDashboardMetrics(period: Period): UseQueryResult<DashboardMetricsDto>; // key ["dashboard","metrics",from,to], placeholderData: keepPreviousData
export function useDashboardActions(): UseQueryResult<DashboardActionsDto>;              // key ["dashboard","actions"]
// components
<KpiCard label value context? delta />           // delta: Delta from computeDelta
<WonChart points bucket />                       // recharts AreaChart
<PipelineCard openNow funnel />                  // bars link to /pipeline
<CreatorsTable creators />
<ActionsPanel actions />                         // Requer ação + Acompanhamento
<PeriodPicker period onChange />                 // presets + De/até popover
```

- [ ] **Step 1: Install recharts**
```bash
/opt/homebrew/bin/pnpm add recharts@^3
```
Confirm the installed version's `peerDependencies` include React 19 (`cat node_modules/recharts/package.json | grep -A4 peerDependencies`). If pnpm drops the rolldown native binding afterwards (vitest "Cannot find native binding"), run `/opt/homebrew/bin/pnpm install --frozen-lockfile --force`.

- [ ] **Step 2: Write the failing tests** (jsdom; mock `next/link` is not needed):

`src/components/dashboard/kpi-card.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCard } from "./kpi-card";

describe("KpiCard", () => {
  it("shows value, context and a good delta with an icon, no glyphs", () => {
    const { container } = render(<KpiCard label="Fechado" value="R$ 84.500,00" context="7 oportunidades" delta={{ label: "18%", direction: "up", tone: "good" }} />);
    expect(screen.getByText("R$ 84.500,00")).toBeTruthy();
    expect(screen.getByText("7 oportunidades")).toBeTruthy();
    const delta = screen.getByTestId("kpi-delta");
    expect(delta.textContent).toContain("18%");
    expect(delta.getAttribute("data-tone")).toBe("good");
    expect(delta.querySelector("svg")).toBeTruthy();
    expect(container.textContent).not.toMatch(/[▲▼✓📅]/u);
  });
  it("shows a dash when there is no comparison", () => {
    render(<KpiCard label="Taxa" value="—" delta={{ label: null, direction: null, tone: "neutral" }} />);
    expect(screen.getByTestId("kpi-delta").textContent).toContain("—");
  });
});
```
`actions-panel.test.tsx`: renders the five "Requer ação" rows with links (`/inbox` for "Mensagens sem triagem", `/proposals` for the others) and "Aguardando resposta do cliente" under "Acompanhamento"; zero rows have `data-zero="true"`; all-zero → text "Tudo em dia" with an svg icon; `truncated: true` → counts rendered as "200+" when equal to 200 or more (render the raw count otherwise).
`period-picker.test.tsx`: clicking "Mês passado" calls `onChange(resolvePreset("last_month", now))` (inject `now` prop for determinism: `<PeriodPicker period={...} onChange={fn} now={new Date("2026-10-05T15:00:00Z")} />`); opening "De/até", typing 2026-10-20 / 2026-10-01 and "Aplicar" shows "A data final deve ser igual ou posterior à inicial." and does not call `onChange`; a valid range calls `onChange({ from, to })`. The active preset button has `aria-pressed="true"`.
`pipeline-card.test.tsx`: header "3 abertas · R$ 2.000,00 em negociação"; one bar per funnel entry with `STAGE_LABELS` text and count; each bar is a link to `/pipeline`.
`creators-table.test.tsx`: rows in the given order; won as "3 · R$ 400,00"; `approvalRate: null` → "—"; 0.75 → "75%".
`won-chart.test.tsx`: mock `recharts` (`vi.mock("recharts", …)` rendering simple divs that expose `data` length via `data-points`) and assert the chart receives one point per bucket and the label formatter turns `2026-10-05` into "05/10" for `day`, "05/10" for `week`, "out/26" for `month`.
`src/hooks/use-dashboard.test.tsx`: `useDashboardMetrics({ from: "2026-10-01", to: "2026-10-31" })` fetches `/api/dashboard/metrics?from=2026-10-01&to=2026-10-31`; `useDashboardActions()` fetches `/api/dashboard/actions` (pattern of `src/hooks/use-crm.test.tsx`, `mockImplementation(() => Promise.resolve(new Response(...)))` so each call gets a fresh body).

- [ ] **Step 3: Run — expect FAIL**: `pnpm vitest run src/components/dashboard src/hooks/use-dashboard.test.tsx`

- [ ] **Step 4: Implement**

`src/hooks/use-dashboard.ts`:
```ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Bucket, Period } from "@/lib/dashboard/period";
import type { OpportunityStage } from "@/lib/opportunity-stages";

export interface PeriodMetricsDto {
  inquiriesReceived: number; inquiriesConverted: number; conversionRate: number | null;
  opportunitiesCreated: number; wonCount: number; wonCents: number; lostCount: number;
  winRate: number | null; averageTicketCents: number | null; averageDaysToClose: number | null;
}
export interface DashboardMetricsDto {
  period: Period; previousPeriod: Period;
  current: PeriodMetricsDto; previous: PeriodMetricsDto;
  series: { bucket: Bucket; points: Array<{ start: string; wonCents: number; wonCount: number }> };
  openNow: { count: number; valueCents: number };
  funnel: Array<{ stage: OpportunityStage; count: number }>;
  creators: Array<{ creatorId: string; name: string; openOpportunities: number; proposalsSent: number; wonCount: number; wonCents: number; approvalRate: number | null }>;
}
export interface DashboardActionsDto {
  untriagedInquiries: number; clientChangesRequested: number; creatorChangesRequested: number;
  awaitingCreatorApproval: number; readyToSend: number; awaitingClient: number; truncated: boolean;
}

export const dashboardQueryKey = ["dashboard"] as const;

export function useDashboardMetrics(period: Period) {
  return useQuery({
    queryKey: [...dashboardQueryKey, "metrics", period.from, period.to],
    queryFn: () => apiFetch<DashboardMetricsDto>(`/api/dashboard/metrics?from=${period.from}&to=${period.to}`),
    placeholderData: keepPreviousData,
  });
}

export function useDashboardActions() {
  return useQuery({ queryKey: [...dashboardQueryKey, "actions"], queryFn: () => apiFetch<DashboardActionsDto>("/api/dashboard/actions") });
}
```

`src/components/dashboard/kpi-card.tsx`:
```tsx
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Delta } from "@/lib/dashboard/delta";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<Delta["tone"], string> = {
  good: "text-success",
  bad: "text-error",
  neutral: "text-muted-foreground",
};

export function KpiCard({ label, value, context, delta }: { label: string; value: string; context?: string; delta: Delta }) {
  const Icon = delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight">{value}</span>
      <div className="flex flex-wrap items-center gap-x-2 text-xs">
        {context ? <span className="text-muted-foreground">{context}</span> : null}
        <span data-testid="kpi-delta" data-tone={delta.tone} className={cn("inline-flex items-center gap-0.5", TONE_CLASS[delta.tone])}>
          {delta.label ? (
            <>
              <Icon className="size-3.5" aria-hidden />
              {delta.label}
              <span className="sr-only"> em relação ao período anterior</span>
            </>
          ) : (
            "—"
          )}
        </span>
      </div>
    </Card>
  );
}
```
(Check the project's Tailwind tokens: if `text-success` does not exist, use the token the project uses for positive state — grep `badge.tsx` variants `success` for the class name.)

`src/components/dashboard/won-chart.tsx`:
```tsx
"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { formatCurrencyBRL } from "@/lib/format";
import type { Bucket } from "@/lib/dashboard/period";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function bucketLabel(start: string, bucket: Bucket): string {
  const [y, m, d] = start.split("-");
  return bucket === "month" ? `${MONTHS[Number(m) - 1]}/${y.slice(2)}` : `${d}/${m}`;
}

export function WonChart({ points, bucket }: { points: Array<{ start: string; wonCents: number; wonCount: number }>; bucket: Bucket }) {
  const data = points.map((p) => ({ ...p, label: bucketLabel(p.start, bucket), value: p.wonCents / 100 }));
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-medium">Fechado ao longo do período</h2>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={64} tickFormatter={(v: number) => formatCurrencyBRL(v * 100)} />
            <Tooltip
              formatter={(value: number) => [formatCurrencyBRL(value * 100), "Fechado"]}
              labelFormatter={(label: string, payload) => {
                const count = (payload?.[0]?.payload as { wonCount?: number } | undefined)?.wonCount ?? 0;
                return `${label} · ${count} ${count === 1 ? "oportunidade" : "oportunidades"}`;
              }}
            />
            <Area type="monotone" dataKey="value" stroke="var(--color-primary, #6d5bd0)" fill="var(--color-primary, #6d5bd0)" fillOpacity={0.12} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
```
(Adjust recharts formatter types to the installed v3 typings if tsc complains; keep behavior. Use the project's primary color token if one exists in `globals.css`.)

`src/components/dashboard/pipeline-card.tsx`:
```tsx
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { STAGE_LABELS, type OpportunityStage } from "@/lib/opportunity-stages";
import { formatCurrencyBRL } from "@/lib/format";

const BAR_COLORS = ["#f97316", "#14b8a6", "#6366f1", "#eab308", "#0ea5e9", "#a855f7", "#ec4899", "#22c55e"];

export function PipelineCard({ openNow, funnel }: { openNow: { count: number; valueCents: number }; funnel: Array<{ stage: OpportunityStage; count: number }> }) {
  const max = Math.max(1, ...funnel.map((f) => f.count));
  return (
    <Card className="p-4">
      <h2 className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm font-medium">
        Pipeline agora
        <span className="font-normal text-muted-foreground">
          {openNow.count} {openNow.count === 1 ? "aberta" : "abertas"} · {formatCurrencyBRL(openNow.valueCents)} em negociação
        </span>
      </h2>
      <ul className="flex flex-col gap-2">
        {funnel.map((entry, index) => (
          <li key={entry.stage}>
            <Link href="/pipeline" className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-muted">
              <span className="truncate">{STAGE_LABELS[entry.stage]}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full" style={{ width: `${(entry.count / max) * 100}%`, backgroundColor: BAR_COLORS[index % BAR_COLORS.length] }} />
              </span>
              <span className="text-right font-medium">{entry.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
```
The pipeline-card test's header assertion must match this exact text format (`"3 abertas · R$ 2.000,00 em negociação"` — check `formatCurrencyBRL` output uses a non-breaking space after "R$"; assert with a regex `/3 abertas · R\$\s2\.000,00 em negociação/`).

`src/components/dashboard/creators-table.tsx`:
```tsx
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrencyBRL } from "@/lib/format";
import type { DashboardMetricsDto } from "@/hooks/use-dashboard";

export function CreatorsTable({ creators }: { creators: DashboardMetricsDto["creators"] }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-medium">Creators</h2>
      {creators.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum creator cadastrado.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Creator</TableHead>
              <TableHead>Oport. abertas</TableHead>
              <TableHead>Propostas enviadas</TableHead>
              <TableHead>Fechadas</TableHead>
              <TableHead>Aprovação (cliente)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {creators.map((c) => (
              <TableRow key={c.creatorId}>
                <TableCell>{c.name}</TableCell>
                <TableCell>{c.openOpportunities}</TableCell>
                <TableCell>{c.proposalsSent}</TableCell>
                <TableCell>{c.wonCount} · {formatCurrencyBRL(c.wonCents)}</TableCell>
                <TableCell>{c.approvalRate === null ? "—" : `${Math.round(c.approvalRate * 100)}%`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
```

`src/components/dashboard/actions-panel.tsx`:
```tsx
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardActionsDto } from "@/hooks/use-dashboard";

type Tone = "red" | "amber" | "violet" | "green" | "gray";
const PILL: Record<Tone, string> = {
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-800",
  violet: "bg-violet-100 text-violet-800",
  green: "bg-green-100 text-green-800",
  gray: "bg-muted text-foreground",
};

function Row({ label, href, count, tone, truncated }: { label: string; href: string; count: number; tone: Tone; truncated: boolean }) {
  const zero = count === 0;
  return (
    <li>
      <Link href={href} data-zero={zero ? "true" : "false"} className={cn("flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-muted", zero && "opacity-50")}>
        <span>{label}</span>
        <span className={cn("min-w-7 rounded-full px-2 text-center text-xs font-semibold", PILL[tone])}>
          {truncated && count >= 200 ? "200+" : count}
        </span>
      </Link>
    </li>
  );
}

export function ActionsPanel({ actions }: { actions: DashboardActionsDto }) {
  const pending = [
    actions.untriagedInquiries, actions.clientChangesRequested, actions.creatorChangesRequested,
    actions.awaitingCreatorApproval, actions.readyToSend,
  ];
  const allClear = pending.every((n) => n === 0);
  const t = actions.truncated;
  return (
    <div className="flex flex-col gap-3">
      <Card className="p-3">
        <h2 className="mb-1 px-2 text-sm font-medium">Requer ação</h2>
        {allClear ? (
          <p className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-green-600" aria-hidden /> Tudo em dia
          </p>
        ) : null}
        <ul>
          <Row label="Mensagens sem triagem" href="/inbox" count={actions.untriagedInquiries} tone="red" truncated={false} />
          <Row label="Ajustes pedidos pelo cliente" href="/proposals" count={actions.clientChangesRequested} tone="amber" truncated={t} />
          <Row label="Ajustes pedidos pelo creator" href="/proposals" count={actions.creatorChangesRequested} tone="amber" truncated={t} />
          <Row label="Aguardando aprovação do creator" href="/proposals" count={actions.awaitingCreatorApproval} tone="violet" truncated={t} />
          <Row label="Prontas para enviar" href="/proposals" count={actions.readyToSend} tone="green" truncated={t} />
        </ul>
      </Card>
      <Card className="p-3">
        <h2 className="mb-1 px-2 text-sm font-medium">Acompanhamento</h2>
        <ul>
          <Row label="Aguardando resposta do cliente" href="/proposals" count={actions.awaitingClient} tone="gray" truncated={t} />
        </ul>
      </Card>
    </div>
  );
}
```
(Prefer the project's existing color tokens if `badge.tsx` defines `success`/`warning`/`error`/`info` variants — reuse those classes instead of raw Tailwind palette names.)

`src/components/dashboard/period-picker.tsx`:
```tsx
"use client";

import * as React from "react";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { periodQuerySchema, resolvePreset, type Period, type Preset } from "@/lib/dashboard/period";

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: "this_month", label: "Este mês" },
  { id: "last_month", label: "Mês passado" },
  { id: "last_90_days", label: "90 dias" },
  { id: "this_year", label: "Este ano" },
];

const formatDate = (date: string) => date.split("-").reverse().join("/");

export function PeriodPicker({ period, onChange, now = new Date() }: { period: Period; onChange: (period: Period) => void; now?: Date }) {
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(period.from);
  const [to, setTo] = React.useState(period.to);
  const [error, setError] = React.useState<string | null>(null);
  const active = PRESETS.find((p) => {
    const r = resolvePreset(p.id, now);
    return r.from === period.from && r.to === period.to;
  })?.id;

  function apply() {
    const parsed = periodQuerySchema.safeParse({ from, to });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Período inválido.");
      return;
    }
    setError(null);
    setOpen(false);
    onChange(parsed.data);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Período">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={active === preset.id}
            onClick={() => onChange(resolvePreset(preset.id, now))}
            className={active === preset.id ? "bg-foreground px-3 py-1.5 text-sm text-background" : "px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setFrom(period.from);
            setTo(period.to);
            setError(null);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="gap-2">
            <CalendarRange className="size-4" aria-hidden />
            {active ? "De/até" : `${formatDate(period.from)} – ${formatDate(period.to)}`}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-72 flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            De
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Até
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {error ? <p role="alert" className="text-xs text-error">{error}</p> : null}
          <Button type="button" onClick={apply}>Aplicar</Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```
In the period-picker test, set the date inputs with `fireEvent.change(input, { target: { value: "2026-10-20" } })` (userEvent typing into `type="date"` is unreliable in jsdom); find inputs by label "De"/"Até".

- [ ] **Step 5: Run — expect PASS**: `pnpm vitest run src/components/dashboard src/hooks/use-dashboard.test.tsx`; `pnpm exec tsc --noEmit -p . 2>&1 | grep -E "dashboard"` prints nothing; `pnpm exec eslint src/components/dashboard src/hooks/use-dashboard.ts src/hooks/use-dashboard.test.tsx` has no errors (name test wrapper components to avoid `react/display-name`).

- [ ] **Step 6: Commit**
```bash
git add package.json pnpm-lock.yaml src/hooks/use-dashboard.ts src/hooks/use-dashboard.test.tsx src/components/dashboard
git commit -m "feat(dashboard): hooks, KPI card, chart (recharts), pipeline, creators table, actions panel, period picker"
```

---

### Task 7: `/dashboard` page

**Files:**
- Create: `src/app/(app)/dashboard/page.tsx`
- Test: `src/app/(app)/dashboard/page.test.tsx`

**Interfaces:** Consumes everything from Task 6 plus `computeDelta`, `resolvePreset`, `periodQuerySchema` (Task 2), `useIsCreator` (`@/components/shell/session-role-context`), `formatCurrencyBRL`.

Before writing: read `node_modules/next/dist/docs/` for `useSearchParams` in client components (this Next.js version may require wrapping the component that calls it in `<Suspense>`). The page default export renders `<React.Suspense fallback={null}><DashboardContent /></React.Suspense>`.

- [ ] **Step 1: Write the failing test** `src/app/(app)/dashboard/page.test.tsx` — mock `next/navigation` (`useRouter` → `{ replace }`, `useSearchParams` → `new URLSearchParams(currentSearch)`), `@/components/shell/session-role-context` (`useIsCreator`), `@/hooks/use-dashboard` (control `data`/`isLoading`/`isError`/`refetch` per hook), and `@/components/dashboard/won-chart` (`WonChart: () => <div data-testid="won-chart" />`). Cases:
  1. No params → `useDashboardMetrics` called with this month's period (use `resolvePreset("this_month", new Date())`).
  2. `?from=2026-09-01&to=2026-09-30` → called with that period; an invalid query (`?from=x`) falls back to this month.
  3. Clicking "Mês passado" calls `router.replace` with `/dashboard?from=…&to=…`.
  4. Renders the 8 card labels: "Fechado", "Taxa de fechamento", "Ticket médio", "Tempo até fechar", "Mensagens recebidas", "Conversão Inbox → Oportunidade", "Oportunidades criadas", "Perdidas"; "Fechado" shows `formatCurrencyBRL(current.wonCents)` and context "N oportunidades"; "Tempo até fechar" shows "18,4 dias".
  5. Actions query error → right column shows "Não foi possível carregar" + "Tentar novamente" (calls its `refetch`) while the left column still shows "Fechado".
  6. Metrics error → left column shows the error with retry; right column still renders "Requer ação".
  7. Creator → `replace("/pipeline")` and renders nothing.
  8. No glyphs: container text does not match `/[▲▼✓📅]/u`.

- [ ] **Step 2: Run — expect FAIL**: `pnpm vitest run dashboard/page`

- [ ] **Step 3: Implement `src/app/(app)/dashboard/page.tsx`**
```tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useIsCreator } from "@/components/shell/session-role-context";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { WonChart } from "@/components/dashboard/won-chart";
import { PipelineCard } from "@/components/dashboard/pipeline-card";
import { CreatorsTable } from "@/components/dashboard/creators-table";
import { ActionsPanel } from "@/components/dashboard/actions-panel";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { useDashboardActions, useDashboardMetrics, type PeriodMetricsDto } from "@/hooks/use-dashboard";
import { computeDelta } from "@/lib/dashboard/delta";
import { periodQuerySchema, resolvePreset, type Period } from "@/lib/dashboard/period";
import { formatCurrencyBRL } from "@/lib/format";

const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const money = (cents: number | null) => (cents === null ? "—" : formatCurrencyBRL(cents));
const days = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ErrorBox({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-2 p-4">
      <p className="text-sm text-muted-foreground">Não foi possível carregar</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button>
    </Card>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />;
}

function cards(current: PeriodMetricsDto, previous: PeriodMetricsDto) {
  return [
    { label: "Fechado", value: money(current.wonCents), context: plural(current.wonCount, "oportunidade", "oportunidades"), delta: computeDelta(current.wonCents, previous.wonCents, "money", true) },
    { label: "Taxa de fechamento", value: percent(current.winRate), context: `${current.wonCount} ganhas · ${current.lostCount} perdidas`, delta: computeDelta(current.winRate, previous.winRate, "rate", true) },
    { label: "Ticket médio", value: money(current.averageTicketCents), context: "por oportunidade ganha", delta: computeDelta(current.averageTicketCents, previous.averageTicketCents, "money", true) },
    { label: "Tempo até fechar", value: days(current.averageDaysToClose), context: "média das fechadas", delta: computeDelta(current.averageDaysToClose, previous.averageDaysToClose, "days", false) },
    { label: "Mensagens recebidas", value: String(current.inquiriesReceived), context: plural(current.inquiriesConverted, "convertida", "convertidas"), delta: computeDelta(current.inquiriesReceived, previous.inquiriesReceived, "count", true) },
    { label: "Conversão Inbox → Oportunidade", value: percent(current.conversionRate), context: "das mensagens do período", delta: computeDelta(current.conversionRate, previous.conversionRate, "rate", true) },
    { label: "Oportunidades criadas", value: String(current.opportunitiesCreated), context: "no período", delta: computeDelta(current.opportunitiesCreated, previous.opportunitiesCreated, "count", true) },
    { label: "Perdidas", value: String(current.lostCount), context: "no período", delta: computeDelta(current.lostCount, previous.lostCount, "count", false) },
  ];
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isCreator = useIsCreator();
  const parsed = periodQuerySchema.safeParse({ from: searchParams.get("from") ?? undefined, to: searchParams.get("to") ?? undefined });
  const period: Period = parsed.success ? parsed.data : resolvePreset("this_month", new Date());
  const metrics = useDashboardMetrics(period);
  const actions = useDashboardActions();

  React.useEffect(() => {
    if (isCreator) router.replace("/pipeline");
  }, [isCreator, router]);
  if (isCreator) return null;

  const setPeriod = (next: Period) => router.replace(`/dashboard?from=${next.from}&to=${next.to}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <aside className="order-first lg:order-last lg:sticky lg:top-4 lg:self-start">
          {actions.isLoading ? <Skeleton className="h-64" /> : actions.isError || !actions.data ? <ErrorBox onRetry={() => actions.refetch()} /> : <ActionsPanel actions={actions.data} />}
        </aside>
        <section className="flex min-w-0 flex-col gap-4">
          {metrics.isLoading ? (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : metrics.isError || !metrics.data ? (
            <ErrorBox onRetry={() => metrics.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {cards(metrics.data.current, metrics.data.previous).map((card) => <KpiCard key={card.label} {...card} />)}
              </div>
              <WonChart points={metrics.data.series.points} bucket={metrics.data.series.bucket} />
              <PipelineCard openNow={metrics.data.openNow} funnel={metrics.data.funnel} />
              <CreatorsTable creators={metrics.data.creators} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <React.Suspense fallback={null}>
      <DashboardContent />
    </React.Suspense>
  );
}
```
Hooks order: `useDashboardMetrics`/`useDashboardActions` run before the creator early return (they fire a request that returns 403 for a creator — accepted, the sidebar hides the link). If the reviewer prefers, pass `enabled: !isCreator` through the hooks — not required by the spec.

- [ ] **Step 4: Run — expect PASS**: `pnpm vitest run dashboard/page`; tsc filter `grep "app/(app)/dashboard"` empty; eslint clean on the page.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/dashboard"
git commit -m "feat(dashboard): /dashboard page"
```

---

### Task 8: Full verification (controller, not a subagent)

- [ ] **Step 1:** `pnpm exec next typegen && pnpm tsc --noEmit` — clean.
- [ ] **Step 2:** `pnpm lint` — no new errors in touched files (repo has pre-existing errors).
- [ ] **Step 3:** Apply migration 0022 to the **test** and **local dev** DBs (controller only): `DATABASE_URL=postgresql://postgres:postgres@localhost:54329/publyflow_test pnpm drizzle-kit migrate` and the same for `publyflow`.
- [ ] **Step 4:** Full suite from the worktree: `pnpm vitest run --dir src --testTimeout=60000 --hookTimeout=60000` (one process).
- [ ] **Step 5:** Build: `OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test pnpm build`.
- [ ] **Step 6:** Manual browser check (user logs in): presets + custom range, compare numbers with `/pipeline` and `/proposals`, deltas, chart buckets (month vs 90 days vs year), mobile layout (actions first), no emoji glyphs.
- [ ] **Step 7:** Deploy order (with the user's go-ahead): apply 0022 in production (`set -a; . ./.env.production.local; set +a; pnpm drizzle-kit migrate`), then push `main`.
- [ ] **Step 8:** Update `TAREFA.md`, commit.
