# Creators List API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose an HTTP read API for Creators (`GET /api/creators`) so the Design System's
Creator Switcher has something to populate itself from — closing the last gap before the
application shell can be built.

**Architecture:** Same layering as every other read API in this codebase: `db/schema` →
`repositories` (`runInTenantContext`) → `services` (thin wrapper) → `app/api` (Zod-validated
route). `CreatorsRepository.listByOrganization` already exists but has no deterministic
ordering; this plan adds that ordering, a thin `CreatorService`, and the route.

**Tech Stack:** Next.js 16 (Route Handlers), Drizzle ORM, PostgreSQL (RLS), Zod, Vitest.

## Global Constraints

- No endpoint of detail (`GET /api/creators/:id`) — not requested, would be REST-symmetry
  speculation with no consuming flow yet.
- No pagination — none exists anywhere in this project; not introduced here.
- No avatar/photo or status field — these columns don't exist on `creators`
  (`src/db/schema/creators.ts`: `id`, `organizationId`, `userId`, `displayName`,
  `instagramHandle`, `createdAt`); do not add them or fake them in the response shape.
- No CRUD beyond listing — `create`/`createWithTx` already exist for onboarding flows and
  are out of scope for this plan.
- The route never calls `CreatorsRepository` directly — it must go through `CreatorService`.
- **Architectural note (not a behavior change in this plan):** `organizationId` is read from
  the query string, matching every other read API in this codebase today. This is transitional
  — compatible with the project's current pre-Auth state. When authentication/session is
  implemented, this endpoint (and its siblings) should evolve to derive `organizationId` from
  the authenticated context instead of requiring the frontend to send it. No action is taken
  on this in the current plan; it's recorded here so the next auth-related plan doesn't have
  to rediscover it.

---

### Task 1: Deterministic ordering for `CreatorsRepository.listByOrganization`

**Files:**
- Modify: `src/repositories/creators.repository.ts`
- Test: `src/repositories/creators.repository.test.ts`

**Interfaces:**
- Modifies: `CreatorsRepository.listByOrganization(db, organizationId): Promise<Creator[]>` —
  signature unchanged, now returns rows ordered by `displayName` ascending instead of
  unordered.

- [ ] **Step 1: Write the failing test**

```typescript
// append to src/repositories/creators.repository.test.ts
it("lists creators ordered deterministically by displayName", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
  const [userA] = await db
    .insert(users)
    .values({ email: "zeca@publyflow.test", fullName: "Zeca" })
    .returning();
  const [userB] = await db
    .insert(users)
    .values({ email: "ana@publyflow.test", fullName: "Ana" })
    .returning();

  // Insert "Zeca Silva" first and "Ana Costa" second, so creation order is
  // the reverse of alphabetical order — proves the ordering is on
  // displayName, not insertion order.
  await CreatorsRepository.create(db, org.id, { userId: userA.id, displayName: "Zeca Silva" });
  await CreatorsRepository.create(db, org.id, { userId: userB.id, displayName: "Ana Costa" });

  const list = await CreatorsRepository.listByOrganization(db, org.id);

  expect(list.map((c) => c.displayName)).toEqual(["Ana Costa", "Zeca Silva"]);
});

it("returns an empty list for an organization with no creators", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const [org] = await db.insert(organizations).values({ name: "Empty Org" }).returning();

  const list = await CreatorsRepository.listByOrganization(db, org.id);

  expect(list).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/creators.repository.test.ts`
Expected: FAIL on the new ordering test — rows come back in insertion order ("Zeca Silva",
"Ana Costa"), not alphabetical. The empty-list test passes already (no code change needed for
it, it's here to lock in the behavior explicitly).

- [ ] **Step 3: Implement deterministic ordering**

```typescript
// src/repositories/creators.repository.ts
// Add `asc` to the existing drizzle-orm import line (currently `import { eq, and } from "drizzle-orm";`):
import { eq, and, asc } from "drizzle-orm";

// Replace the body of listByOrganization:
  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Creator[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(creators)
        .where(eq(creators.organizationId, organizationId))
        .orderBy(asc(creators.displayName));
    });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/creators.repository.test.ts`
Expected: PASS (all 4 tests: the two pre-existing ones, plus the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/repositories/creators.repository.ts src/repositories/creators.repository.test.ts
git commit -m "feat: order CreatorsRepository.listByOrganization deterministically by displayName"
```

---

### Task 2: `CreatorService` + `GET /api/creators`

**Files:**
- Create: `src/services/creator.service.ts`
- Create: `src/app/api/creators/route.ts`
- Test: `src/app/api/creators/route.test.ts`

**Interfaces:**
- Consumes: `CreatorsRepository.listByOrganization(db, organizationId): Promise<Creator[]>`
  (Task 1's ordering applies here automatically).
- Produces: `CreatorService.listByOrganization(db, organizationId): Promise<Creator[]>` from
  `src/services/creator.service.ts` — thin wrapper, same pattern as `CompanyService`/
  `ContactService`/`LeadService`.
- Produces: `GET /api/creators?organizationId=` → `200` with `Creator[]`.

- [ ] **Step 1: Implement `CreatorService`**

```typescript
// src/services/creator.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { CreatorsRepository, type Creator } from "@/repositories/creators.repository";

export const CreatorService = {
  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Creator[]> {
    return CreatorsRepository.listByOrganization(db, organizationId);
  },
};
```

There's no test-first step for this file in isolation — it has no branching logic of its own
(a pure delegate), so its behavior is verified through the route test in Step 3 below, the
same way `CompanyService`/`ContactService` were verified in the prior plan.

- [ ] **Step 2: Write the failing route test**

```typescript
// src/app/api/creators/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { CreatorsRepository } from "@/repositories/creators.repository";

describe("GET /api/creators", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the organization's creators, ordered by displayName", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [userA] = await db
      .insert(users)
      .values({ email: "zeca@publyflow.test", fullName: "Zeca" })
      .returning();
    const [userB] = await db
      .insert(users)
      .values({ email: "ana@publyflow.test", fullName: "Ana" })
      .returning();
    await CreatorsRepository.create(db, org.id, { userId: userA.id, displayName: "Zeca Silva" });
    await CreatorsRepository.create(db, org.id, { userId: userB.id, displayName: "Ana Costa" });

    const { GET } = await import("./route");

    const request = new Request(`http://localhost/api/creators?organizationId=${org.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.map((row: { displayName: string }) => row.displayName)).toEqual([
      "Ana Costa",
      "Zeca Silva",
    ]);
  });

  it("does not return creators from another organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [orgA] = await db.insert(organizations).values({ name: "Org A" }).returning();
    const [orgB] = await db.insert(organizations).values({ name: "Org B" }).returning();
    const [userB] = await db
      .insert(users)
      .values({ email: "creator-b@publyflow.test", fullName: "Creator B" })
      .returning();
    await CreatorsRepository.create(db, orgB.id, { userId: userB.id, displayName: "Creator B" });

    const { GET } = await import("./route");

    const request = new Request(`http://localhost/api/creators?organizationId=${orgA.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/creators/route.test.ts`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 4: Implement the route**

```typescript
// src/app/api/creators/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CreatorService } from "@/services/creator.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });
  const list = await CreatorService.listByOrganization(db, payload.organizationId);
  return NextResponse.json(list, { status: 200 });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/creators/route.test.ts`
Expected: PASS (both tests: own-org list ordered correctly, cross-org isolation).

- [ ] **Step 6: Verify the app builds, run the full suite, then commit**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test pnpm build
pnpm test
git add src/services/creator.service.ts src/app/api/creators
git commit -m "feat: add GET /api/creators"
```

---

## Self-Review

**Spec coverage:**
- §2 Decision 1 (list endpoint, ordered by `displayName` asc) — Task 1 (ordering) + Task 2
  (route).
- §2 Decision 2 (no detail endpoint) — correctly absent from both tasks.
- §2 Decision 3 (thin `CreatorService`, route never calls repository directly) — Task 2.
- §2 Decision 4 (multi-tenant isolation) — already enforced by `runInTenantContext` +
  explicit `organizationId` predicate in `listByOrganization`; Task 2's route test adds an
  explicit cross-org assertion to lock in the behavior at the HTTP layer too.
- §2 Decision 5 (full `Creator` shape, no DTO projection) — the route returns whatever
  `CreatorService.listByOrganization` returns unmodified; no projection/mapping step was
  added anywhere.
- §3 test list (own-org listing, cross-org isolation, empty org, deterministic ordering) —
  all four are present: Task 1 covers ordering + empty-org at the repository layer, Task 2
  covers own-org + cross-org at the route layer.
- The architectural note about `organizationId` being transitional pre-Auth is recorded in
  Global Constraints, as instructed — no task acts on it, since no action was requested.

**Placeholder scan:** none — every step has literal code, no TBD/TODO.

**Type consistency:** `CreatorService.listByOrganization(db, organizationId): Promise<Creator[]>`
in Task 2 matches `CreatorsRepository.listByOrganization`'s exact signature from Task 1 (same
parameter order, same return type `Creator[]`, `Creator` imported from the same repository
module both times).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-creators-list-api.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
