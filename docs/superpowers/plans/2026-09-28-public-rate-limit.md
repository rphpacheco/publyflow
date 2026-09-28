# Public Rate Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rate-limit per IP the public proposal response POST and the public page `/p/[token]`, and cap the POST body at 16 KB.

**Architecture:**
- **Counters:** fixed-window counters in a new Postgres table `rate_limit_buckets` (migration 0019), updated with one atomic upsert per request.
- **Core helper:** `checkRateLimit` in `src/lib/rate-limit.ts`. It hashes the IP (SHA-256), computes the window and returns `{ allowed, retryAfterSeconds }`. It fails open on any error.
- **Where each limit applies:**
  - the POST route checks the declared body size, then the rate limit, then reads the body with a byte cap;
  - `src/proxy.ts` checks the page limit for `/p/…` only.
- **Retention:** the daily cron route purges windows older than 24 h.

**Tech Stack:** Next.js 16 (route handlers, `src/proxy.ts` on the Node.js runtime), Drizzle + Postgres, `node:crypto`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-28-public-rate-limit-design.md`

## Global Constraints

- **Next.js docs:** Next.js 16 — read `node_modules/next/dist/docs/` before writing Next code (AGENTS.md). Proxy runs on Node.js (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
- **Limits, per IP:**

  | Surface | Scope | Limit | Window |
  |---|---|---|---|
  | public response POST | `"public-response"` | 10 | 600 s |
  | public page | `"public-page"` | 60 | 60 s |

- **Body cap:** 16384 bytes (16 KB) on the public response POST.
- **Status codes:**
  - 413 body `{ "error": "Requisição muito grande." }`;
  - 429 POST body `{ "error": "Muitas tentativas. Tente novamente em alguns minutos." }`;
  - 429 page body (text/plain; charset=utf-8) `Muitas requisições. Aguarde um minuto e recarregue a página.`;
  - every 413/429 carries `Cache-Control: no-store`, and every 429 carries `Retry-After` in whole seconds (≥ 1).
- **Client copy on 429:** `Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.`
- **Key:** `${scope}:${sha256(ip ?? "unknown")}` as lowercase hex. The raw IP is never stored or logged.
- **IP source:** `x-real-ip`, else the first comma-separated value of `x-forwarded-for` (trimmed), else `null`.
- **Fail-open:** any error inside the check → `{ allowed: true, retryAfterSeconds: 0 }` plus `console.error("Rate limit check failed", error)`.
- **Retention:** the cron route purges `window_start < now − 24 h`. A purge failure is logged and does not change the route's response.
- **DB rule:** implementers never run migrations or touch any DB outside the Vitest suite; the controller applies migration 0019.
- **Commands:**
  - pnpm: `/opt/homebrew/bin/pnpm`;
  - full suite: `/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000`;
  - build: `OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build`.
- **Commits:** end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, whatever model you are.
- **Worktree shell:** run plain single commands (no chained git/pnpm with variables; no `cd` elsewhere).

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema/rate-limit.ts` | `rateLimitBuckets` table |
| `src/db/migrations/0019_add_rate_limit_buckets.sql` (+ meta) | generated DDL |
| `src/repositories/rate-limit.repository.ts` | `hit`, `purgeOlderThan` |
| `src/lib/client-ip.ts` | `clientIp(headers)` |
| `src/lib/rate-limit.ts` | `checkRateLimit`, limit constants |
| `src/lib/read-json-with-limit.ts` | `declaredLengthExceeds`, `readJsonWithLimit`, `PayloadTooLargeError` |
| `src/app/api/public/proposals/[token]/responses/route.ts` | 413 / 429 before the existing flow |
| `src/proxy.ts` | 429 for `/p/…` |
| `src/components/presentation/public-proposal-view.tsx` | 429 message |
| `src/app/api/internal/events/drain/route.ts` | daily purge |

---

### Task 1: Rate-limit storage and `checkRateLimit`

**Files:**
- Create: `src/db/schema/rate-limit.ts`, `src/repositories/rate-limit.repository.ts`, `src/lib/client-ip.ts`, `src/lib/rate-limit.ts`
- Modify: `src/db/schema/index.ts` (add `export * from "./rate-limit";`), `src/test/helpers/db.ts` (add `"rate_limit_buckets",` as the first entry of `DOMAIN_TABLES`)
- Create (generated): `src/db/migrations/0019_add_rate_limit_buckets.sql` + `meta/0019_snapshot.json` + journal entry
- Test: `src/lib/rate-limit.test.ts`, `src/lib/client-ip.test.ts`, `src/repositories/rate-limit.repository.test.ts`

**Interfaces:**
- Produces:
  - `RateLimitRepository.hit(db, key: string, windowStart: Date): Promise<number>` — the count after incrementing.
  - `RateLimitRepository.purgeOlderThan(db, cutoff: Date): Promise<number>` — the number of rows deleted.
  - `clientIp(headers: Headers): string | null`.
  - `checkRateLimit(db, options: { scope: string; ip: string | null; limit: number; windowSeconds: number; now?: Date }): Promise<{ allowed: boolean; retryAfterSeconds: number }>`.
  - `PUBLIC_RESPONSE_LIMIT = { scope: "public-response", limit: 10, windowSeconds: 600 } as const`.
  - `PUBLIC_PAGE_LIMIT = { scope: "public-page", limit: 60, windowSeconds: 60 } as const`.
  - `rateLimitKey(scope: string, ip: string | null): string`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/client-ip.test.ts
import { describe, it, expect } from "vitest";
import { clientIp } from "./client-ip";

describe("clientIp", () => {
  it("prefers x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
  });

  it("falls back to the first x-forwarded-for value, trimmed", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" }))).toBe("198.51.100.1");
  });

  it("returns null without either header", () => {
    expect(clientIp(new Headers())).toBeNull();
  });
});
```

```typescript
// src/repositories/rate-limit.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { RateLimitRepository } from "./rate-limit.repository";

describe("RateLimitRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("increments atomically per key and window", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const window = new Date("2026-09-28T12:00:00Z");

    expect(await RateLimitRepository.hit(db, "a", window)).toBe(1);
    expect(await RateLimitRepository.hit(db, "a", window)).toBe(2);
    expect(await RateLimitRepository.hit(db, "b", window)).toBe(1);
    expect(await RateLimitRepository.hit(db, "a", new Date("2026-09-28T12:01:00Z"))).toBe(1);

    const counts = await Promise.all(Array.from({ length: 5 }, () => RateLimitRepository.hit(db, "c", window)));
    expect(counts.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });

  it("purges only windows older than the cutoff", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    await RateLimitRepository.hit(db, "old", new Date("2026-09-27T11:00:00Z"));
    await RateLimitRepository.hit(db, "new", new Date("2026-09-28T11:00:00Z"));

    expect(await RateLimitRepository.purgeOlderThan(db, new Date("2026-09-27T12:00:00Z"))).toBe(1);
    const rows = await db.select().from(rateLimitBuckets);
    expect(rows.map((row) => row.key)).toEqual(["new"]);
  });
});
```

```typescript
// src/lib/rate-limit.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { withTestDb } from "@/test/helpers/db";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { RateLimitRepository } from "@/repositories/rate-limit.repository";
import { checkRateLimit, rateLimitKey } from "./rate-limit";

const at = (iso: string) => new Date(iso);

describe("checkRateLimit", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup?.();
  });

  it("allows up to the limit, then blocks until the window ends", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const options = { scope: "public-page", ip: "203.0.113.7", limit: 3, windowSeconds: 60 };

    for (let i = 0; i < 3; i += 1) {
      expect((await checkRateLimit(db, { ...options, now: at("2026-09-28T12:00:10Z") })).allowed).toBe(true);
    }
    expect(await checkRateLimit(db, { ...options, now: at("2026-09-28T12:00:30Z") })).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    expect((await checkRateLimit(db, { ...options, now: at("2026-09-28T12:01:00Z") })).allowed).toBe(true);
  });

  it("rounds Retry-After up and never returns less than 1", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const options = { scope: "s", ip: "203.0.113.7", limit: 0, windowSeconds: 60 };

    expect((await checkRateLimit(db, { ...options, now: at("2026-09-28T12:00:59.500Z") })).retryAfterSeconds).toBe(1);
    expect((await checkRateLimit(db, { ...options, now: at("2026-09-28T12:00:10.200Z") })).retryAfterSeconds).toBe(50);
  });

  it("keeps IPs and scopes independent", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const now = at("2026-09-28T12:00:00Z");

    expect((await checkRateLimit(db, { scope: "a", ip: "203.0.113.7", limit: 1, windowSeconds: 60, now })).allowed).toBe(true);
    expect((await checkRateLimit(db, { scope: "a", ip: "203.0.113.8", limit: 1, windowSeconds: 60, now })).allowed).toBe(true);
    expect((await checkRateLimit(db, { scope: "b", ip: "203.0.113.7", limit: 1, windowSeconds: 60, now })).allowed).toBe(true);
    expect((await checkRateLimit(db, { scope: "a", ip: "203.0.113.7", limit: 1, windowSeconds: 60, now })).allowed).toBe(false);
  });

  it("stores only a hash of the IP", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    await checkRateLimit(db, { scope: "public-page", ip: "203.0.113.7", limit: 5, windowSeconds: 60 });

    const [row] = await db.select().from(rateLimitBuckets);
    expect(row.key).toBe(`public-page:${createHash("sha256").update("203.0.113.7").digest("hex")}`);
    expect(row.key).not.toContain("203.0.113.7");
    expect(rateLimitKey("x", null)).toBe(`x:${createHash("sha256").update("unknown").digest("hex")}`);
  });

  it("fails open and logs when the store errors", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.spyOn(RateLimitRepository, "hit").mockRejectedValueOnce(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await checkRateLimit(db, { scope: "s", ip: "203.0.113.7", limit: 1, windowSeconds: 60 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(log).toHaveBeenCalledWith("Rate limit check failed", expect.any(Error));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/client-ip.test.ts src/lib/rate-limit.test.ts src/repositories/rate-limit.repository.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Schema and migration**

```typescript
// src/db/schema/rate-limit.ts
import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** Fixed-window request counters for public surfaces. Global (not tenant data); no RLS. */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.windowStart] }),
    index("rate_limit_buckets_window_idx").on(table.windowStart),
  ],
);
```

Add `export * from "./rate-limit";` to `src/db/schema/index.ts`, and `"rate_limit_buckets",` as the first entry of `DOMAIN_TABLES` in `src/test/helpers/db.ts`.

Generate the migration: `/opt/homebrew/bin/pnpm drizzle-kit generate --name add_rate_limit_buckets </dev/null`. It must not prompt. If it asks about renames, STOP and report NEEDS_CONTEXT. Confirm the SQL creates only `rate_limit_buckets`, its composite primary key and the index. No RLS SQL is appended.

- [ ] **Step 4: STOP**

Report NEEDS_CONTEXT with "migration 0019 generated, awaiting controller to apply" and the file path. Don't commit. The controller applies it to the test and dev DBs and resumes you.

- [ ] **Step 5: Implement**

```typescript
// src/repositories/rate-limit.repository.ts
import { lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { rateLimitBuckets } from "@/db/schema/rate-limit";

export const RateLimitRepository = {
  /** Atomically counts one request in (key, window) and returns the new count. */
  async hit(db: NodePgDatabase<typeof schema>, key: string, windowStart: Date): Promise<number> {
    const [row] = await db
      .insert(rateLimitBuckets)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
        set: { count: sql`${rateLimitBuckets.count} + 1` },
      })
      .returning({ count: rateLimitBuckets.count });
    return row.count;
  },

  async purgeOlderThan(db: NodePgDatabase<typeof schema>, cutoff: Date): Promise<number> {
    const deleted = await db
      .delete(rateLimitBuckets)
      .where(lt(rateLimitBuckets.windowStart, cutoff))
      .returning({ key: rateLimitBuckets.key });
    return deleted.length;
  },
};
```

```typescript
// src/lib/client-ip.ts
/** The caller's IP as set by the platform (Vercel overwrites both headers). */
export function clientIp(headers: Headers): string | null {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}
```

```typescript
// src/lib/rate-limit.ts
import { createHash } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { RateLimitRepository } from "@/repositories/rate-limit.repository";

export const PUBLIC_RESPONSE_LIMIT = { scope: "public-response", limit: 10, windowSeconds: 600 } as const;
export const PUBLIC_PAGE_LIMIT = { scope: "public-page", limit: 60, windowSeconds: 60 } as const;

export interface RateLimitOptions {
  scope: string;
  ip: string | null;
  limit: number;
  windowSeconds: number;
  now?: Date;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** The raw IP is never stored: only its SHA-256, namespaced by scope. */
export function rateLimitKey(scope: string, ip: string | null): string {
  return `${scope}:${createHash("sha256").update(ip ?? "unknown").digest("hex")}`;
}

/**
 * Fixed-window limit. Fails open: an error here must never take a public
 * page down (if the DB is down, the page fails anyway).
 */
export async function checkRateLimit(
  db: NodePgDatabase<typeof schema>,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  try {
    const windowMs = options.windowSeconds * 1000;
    const nowMs = (options.now ?? new Date()).getTime();
    const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
    const count = await RateLimitRepository.hit(db, rateLimitKey(options.scope, options.ip), new Date(windowStartMs));
    return {
      allowed: count <= options.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000)),
    };
  } catch (error) {
    console.error("Rate limit check failed", error);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
```

- [ ] **Step 6: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/lib/client-ip.test.ts src/lib/rate-limit.test.ts src/repositories/rate-limit.repository.test.ts
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/db src/repositories/rate-limit.repository.ts src/repositories/rate-limit.repository.test.ts src/lib/client-ip.ts src/lib/client-ip.test.ts src/lib/rate-limit.ts src/lib/rate-limit.test.ts src/test/helpers/db.ts
git commit -m "feat: add Postgres-backed fixed-window rate limiter"
```

---

### Task 2: Body cap and rate limit on the public response POST

**Files:**
- Create: `src/lib/read-json-with-limit.ts`
- Modify: `src/app/api/public/proposals/[token]/responses/route.ts`
- Test: `src/lib/read-json-with-limit.test.ts`, `src/app/api/public/proposals/[token]/responses/route.test.ts` (add cases)

**Interfaces:**
- Consumes: `checkRateLimit`, `PUBLIC_RESPONSE_LIMIT`, `clientIp`, `RateLimitRepository` (Task 1).
- Produces:
  - `MAX_PUBLIC_BODY_BYTES = 16384`;
  - `class PayloadTooLargeError extends Error`;
  - `declaredLengthExceeds(request: Request, maxBytes: number): boolean`;
  - `readJsonWithLimit(request: Request, maxBytes: number): Promise<unknown | null>`, which throws `PayloadTooLargeError` past the cap and returns `null` on invalid JSON or an empty body.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/read-json-with-limit.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PayloadTooLargeError, declaredLengthExceeds, readJsonWithLimit } from "./read-json-with-limit";

function streamOf(text: string, chunkSize = 1024) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);

describe("declaredLengthExceeds", () => {
  it("is true only when Content-Length is above the cap", () => {
    expect(declaredLengthExceeds(post("{}", { "content-length": "20000" }), 16384)).toBe(true);
    expect(declaredLengthExceeds(post("{}", { "content-length": "16384" }), 16384)).toBe(false);
    expect(declaredLengthExceeds(post(streamOf("{}")), 16384)).toBe(false);
  });
});

describe("readJsonWithLimit", () => {
  it("parses JSON within the cap, including multi-byte characters", async () => {
    expect(await readJsonWithLimit(post(streamOf(JSON.stringify({ message: "ação 😀" }), 3)), 16384)).toEqual({
      message: "ação 😀",
    });
  });

  it("throws when the streamed body passes the cap without Content-Length", async () => {
    await expect(readJsonWithLimit(post(streamOf("x".repeat(20000))), 16384)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("throws on a declared Content-Length above the cap without reading", async () => {
    await expect(
      readJsonWithLimit(post("{}", { "content-length": "20000" }), 16384),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("returns null for invalid JSON or an empty body", async () => {
    expect(await readJsonWithLimit(post(streamOf("{not json")), 16384)).toBeNull();
    expect(await readJsonWithLimit(new Request("http://localhost/x", { method: "POST" }), 16384)).toBeNull();
  });
});
```

Add to `src/app/api/public/proposals/[token]/responses/route.test.ts`, inside the existing `describe`. It reuses `published()`, `request`, `params` and `scheduleEventDrain` already in the file. Add `import { RateLimitRepository } from "@/repositories/rate-limit.repository";` to the imports.

```typescript
  it("413 when Content-Length is above 16 KB, without touching the database", async () => {
    const { POST, token } = await published();
    const hit = vi.spyOn(RateLimitRepository, "hit");
    const response = await POST(
      new Request(`http://localhost/api/public/proposals/${token}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "20000" },
        body: "{}",
      }),
      params(token),
    );
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Requisição muito grande." });
    expect(hit).not.toHaveBeenCalled();
    hit.mockRestore();
  });

  it("413 when the streamed body passes 16 KB without Content-Length", async () => {
    const { POST, token } = await published();
    const big = new TextEncoder().encode(JSON.stringify({ message: "x".repeat(20000) }));
    const response = await POST(
      new Request(`http://localhost/api/public/proposals/${token}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(big);
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit),
      params(token),
    );
    expect(response.status).toBe(413);
  });

  it("429 with Retry-After on the 11th request from the same IP within 10 minutes", async () => {
    const { POST, token } = await published();
    const fromIp = () =>
      new Request(`http://localhost/api/public/proposals/${token}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
        body: JSON.stringify({}),
      });

    for (let i = 0; i < 10; i += 1) {
      expect((await POST(fromIp(), params(token))).status).toBe(400);
    }
    const blocked = await POST(fromIp(), params(token));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(blocked.headers.get("cache-control")).toBe("no-store");
    expect(await blocked.json()).toEqual({ error: "Muitas tentativas. Tente novamente em alguns minutos." });

    const otherIp = new Request(`http://localhost/api/public/proposals/${token}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.8" },
      body: JSON.stringify({}),
    });
    expect((await POST(otherIp, params(token))).status).toBe(400);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/read-json-with-limit.test.ts "src/app/api/public/proposals/[token]/responses/route.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/lib/read-json-with-limit.ts
export const MAX_PUBLIC_BODY_BYTES = 16384;

export class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

/** Cheap pre-check on the declared size; the header can be absent or lie, so reading still caps. */
export function declaredLengthExceeds(request: Request, maxBytes: number): boolean {
  const declared = Number(request.headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
}

/** Reads at most `maxBytes` of the body; null for an empty body or invalid JSON. */
export async function readJsonWithLimit(request: Request, maxBytes: number): Promise<unknown | null> {
  if (declaredLengthExceeds(request, maxBytes)) throw new PayloadTooLargeError(maxBytes);
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
```

In `src/app/api/public/proposals/[token]/responses/route.ts`:
- add the imports:

```typescript
import { checkRateLimit, PUBLIC_RESPONSE_LIMIT } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import {
  MAX_PUBLIC_BODY_BYTES,
  PayloadTooLargeError,
  declaredLengthExceeds,
  readJsonWithLimit,
} from "@/lib/read-json-with-limit";
```

- replace the start of `POST`, up to and including the `safeParse` line, with:

```typescript
const TOO_LARGE = { error: "Requisição muito grande." };

// Public: no session. Everything resolves through token → proposal → publication.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (declaredLengthExceeds(request, MAX_PUBLIC_BODY_BYTES)) {
    return NextResponse.json(TOO_LARGE, { status: 413, headers: NO_STORE });
  }

  const limit = await checkRateLimit(db, { ...PUBLIC_RESPONSE_LIMIT, ip: clientIp(request.headers) });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente novamente em alguns minutos." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let raw: unknown;
  try {
    raw = await readJsonWithLimit(request, MAX_PUBLIC_BODY_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json(TOO_LARGE, { status: 413, headers: NO_STORE });
    }
    throw error;
  }
  const parsed = bodySchema.safeParse(raw);
```

The rest of the handler is unchanged. Keep the `// Public: no session…` comment directly above `POST`, and put `const TOO_LARGE` next to `const NO_STORE`.

- [ ] **Step 4: Run the tests (the existing response route tests must stay green), full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/lib/read-json-with-limit.test.ts "src/app/api/public/proposals/[token]/responses/route.test.ts"
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/lib/read-json-with-limit.ts src/lib/read-json-with-limit.test.ts "src/app/api/public/proposals/[token]"
git commit -m "feat: cap body size and rate-limit the public proposal response"
```

---

### Task 3: Rate limit on the public page in the proxy

**Files:**
- Modify: `src/proxy.ts`
- Test: `src/proxy.test.ts` (add cases; extend `importProxy`)

**Interfaces:**
- Consumes: `checkRateLimit`, `PUBLIC_PAGE_LIMIT`, `clientIp` (Task 1); `db` from `@/db`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Replace `importProxy` in `src/proxy.test.ts` and add the cases:

```typescript
const checkRateLimit = vi.fn();

async function importProxy(user: { id: string } | null) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test");
  vi.doMock("@supabase/ssr", () => ({
    createServerClient: () => ({
      auth: { getUser: async () => ({ data: { user }, error: null }) },
    }),
  }));
  vi.doMock("@/db", () => ({ db: {} }));
  vi.doMock("@/lib/rate-limit", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
    checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
  }));
  return import("./proxy");
}
```

Inside `describe("proxy")`, add `beforeEach(() => { checkRateLimit.mockReset(); checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }); });` and import `beforeEach` from vitest. Then:

```typescript
  it("rate-limits the public proposal page per IP with 429 and Retry-After", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    const { proxy } = await importProxy(null);
    const response = await proxy(
      new NextRequest("http://localhost:3000/p/abc", { headers: { "x-real-ip": "203.0.113.7" } }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("Muitas requisições. Aguarde um minuto e recarregue a página.");
    expect(checkRateLimit).toHaveBeenCalledWith(
      {},
      { scope: "public-page", limit: 60, windowSeconds: 60, ip: "203.0.113.7" },
    );
  });

  it("lets the public page through when under the limit", async () => {
    const { proxy } = await importProxy(null);
    const response = await proxy(new NextRequest("http://localhost:3000/p/abc"));
    expect(response.status).toBe(200);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });

  it("never rate-limits other paths", async () => {
    const { proxy } = await importProxy({ id: "a" });
    await proxy(new NextRequest("http://localhost:3000/pipeline"));
    await proxy(new NextRequest("http://localhost:3000/login"));
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/proxy.test.ts`
Expected: FAIL (no 429; `checkRateLimit` not called).

- [ ] **Step 3: Implement**

At the top of `proxy()` in `src/proxy.ts`, before creating the Supabase client, insert:

```typescript
  if (request.nextUrl.pathname.startsWith("/p/")) {
    const limit = await checkRateLimit(db, { ...PUBLIC_PAGE_LIMIT, ip: clientIp(request.headers) });
    if (!limit.allowed) {
      return new NextResponse("Muitas requisições. Aguarde um minuto e recarregue a página.", {
        status: 429,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": String(limit.retryAfterSeconds),
        },
      });
    }
  }
```

and the imports:

```typescript
import { db } from "@/db";
import { checkRateLimit, PUBLIC_PAGE_LIMIT } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
```

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/proxy.test.ts
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/proxy.ts src/proxy.test.ts
git commit -m "feat: rate-limit the public proposal page in the proxy"
```

---

### Task 4: Client message on 429 and daily purge

**Files:**
- Modify: `src/components/presentation/public-proposal-view.tsx`, `src/app/api/internal/events/drain/route.ts`
- Test: `src/components/presentation/public-proposal-view.test.tsx`, `src/app/api/internal/events/drain/route.test.ts` (add cases)

**Interfaces:**
- Consumes: `RateLimitRepository.hit`, `RateLimitRepository.purgeOlderThan`, `rateLimitBuckets` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/presentation/public-proposal-view.test.tsx`:

```typescript
  it("429 asks to wait and keeps what was typed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "x" }), { status: 429, headers: { "Retry-After": "300" } }),
    );
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Maria");
    await userEvent.type(screen.getByLabelText("E-mail"), "maria@bella.test");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recarregar" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toHaveValue("Maria");
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });
```

Add to `src/app/api/internal/events/drain/route.test.ts`, following that file's existing setup (`withTestDb`, `importRouteWithSession`, `vi.stubEnv("CRON_SECRET", "s3cret")`, and the file's request helper for an authorized GET). Import `RateLimitRepository` and `rateLimitBuckets`:

```typescript
  it("purges rate-limit windows older than 24 hours", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.stubEnv("CRON_SECRET", "s3cret");
    await RateLimitRepository.hit(db, "old", new Date(Date.now() - 25 * 3600 * 1000));
    await RateLimitRepository.hit(db, "recent", new Date(Date.now() - 3600 * 1000));
    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    expect((await GET(request("GET", "s3cret"))).status).toBe(200);
    const rows = await db.select().from(rateLimitBuckets);
    expect(rows.map((row) => row.key)).toEqual(["recent"]);
  });

  it("still answers 200 when the purge fails", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.stubEnv("CRON_SECRET", "s3cret");
    const purge = vi.spyOn(RateLimitRepository, "purgeOlderThan").mockRejectedValueOnce(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    expect((await GET(request("GET", "s3cret"))).status).toBe(200);
    expect(log).toHaveBeenCalledWith("Rate limit purge failed", expect.any(Error));
    purge.mockRestore();
    log.mockRestore();
  });
```

Use the file's actual request-helper name. If it isn't `request(method, token)`, adapt the calls.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/components/presentation/public-proposal-view.test.tsx src/app/api/internal/events/drain/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `public-proposal-view.tsx`, add a branch before the final `else` of the error chain:

```typescript
      } else if (result.status === 429) {
        setServerError({ message: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.", reload: false });
```

In `src/app/api/internal/events/drain/route.ts`, after `const result = await EventDrainService.drain(db);`:

```typescript
  try {
    await RateLimitRepository.purgeOlderThan(db, new Date(Date.now() - RATE_LIMIT_RETENTION_MS));
  } catch (error) {
    console.error("Rate limit purge failed", error);
  }
```

with `const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;` at module level, and `import { RateLimitRepository } from "@/repositories/rate-limit.repository";`.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/components/presentation/public-proposal-view.test.tsx src/app/api/internal/events/drain/route.test.ts
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/components/presentation src/app/api/internal/events/drain
git commit -m "feat: explain 429 on the public form and purge old rate-limit windows daily"
```

---

## Deploy (controller, after merge)

1. Apply migration 0019 to Supabase production **before** the push (`set -a; . ./.env.production.local; set +a; drizzle-kit migrate`).
2. Confirm `has_table_privilege('anon'|'authenticated', 'public.rate_limit_buckets', 'select')` is false.
3. The user pushes `main`.
4. Smoke test: open `/p/<token>` in production (200); call `curl -s -o /dev/null -w "%{http_code}"` 11 times on the response POST with `{}`. Expect 400 ten times, then 429.

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3 schema | 1 |
| §4.1 repository | 1 |
| §4.2 `checkRateLimit` | 1 |
| §4.3 `clientIp` | 1 |
| §4.4 `readJsonWithLimit` | 2 |
| §5 POST order, limits, bodies | 2 |
| §5 proxy | 3 |
| §6 client copy | 4 |
| §7 retention | 4 |
| §8 tests | 1–4 |
| §9 deploy | Deploy section |

**Placeholder scan:** every step has complete code. One adaptation is flagged explicitly: the name of the drain test's request helper.

**Type consistency:**

| Name | Defined in | Used in |
|---|---|---|
| `checkRateLimit(db, { scope, ip, limit, windowSeconds, now? })` | Task 1 | Tasks 2 and 3 |
| `PUBLIC_RESPONSE_LIMIT`, `PUBLIC_PAGE_LIMIT` | Task 1 | Tasks 2 and 3 |
| `clientIp(headers)` | Task 1 | Tasks 2 and 3 |
| `RateLimitRepository.hit` | Task 1 | Tasks 2 and 4 |
| `RateLimitRepository.purgeOlderThan` | Task 1 | Task 4 |
| `readJsonWithLimit`, `declaredLengthExceeds`, `PayloadTooLargeError`, `MAX_PUBLIC_BODY_BYTES` | Task 2 | Task 2 |
