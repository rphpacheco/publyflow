# Brands List API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose `GET /api/brands?organizationId=` so the Inbox screen's edit-mode Brand
Combobox has a real API to list an organization's brands from.

**Architecture:** Mirrors `GET /api/companies` exactly: `BrandsRepository` gains
`listByOrganization`, a new thin `BrandService` wraps it, a new route exposes it.

**Tech Stack:** Next.js 16 (Route Handlers), Drizzle ORM, PostgreSQL, Zod, Vitest.

## Global Constraints

- `listByOrganization(db, organizationId): Promise<Brand[]>`, ordered by `createdAt desc` —
  same signature shape and ordering as `CompaniesRepository.listByOrganization`.
- No `GET /api/brands/:id`, no `POST /api/brands`, no pagination — listing only.
- `BrandsRepository.listByName`/`create` are unchanged.

---

### Task 1: `BrandsRepository.listByOrganization` + `BrandService` + `GET /api/brands`

**Files:**
- Modify: `src/repositories/brands.repository.ts`
- Create: `src/services/brand.service.ts`
- Create: `src/app/api/brands/route.ts`
- Test: `src/repositories/brands.repository.test.ts`
- Test: `src/app/api/brands/route.test.ts`

**Interfaces:**
- Produces: `BrandsRepository.listByOrganization(db, organizationId): Promise<Brand[]>`.
- Produces: `BrandService.listByOrganization(db, organizationId): Promise<Brand[]>` from
  `src/services/brand.service.ts` — thin wrapper, same pattern as `CompanyService`.
- Produces: `GET /api/brands?organizationId=` → `200` with `Brand[]`.

- [ ] **Step 1: Write the failing repository test**

Read the current content of `src/repositories/brands.repository.test.ts` first (it exists
from an earlier plan, with one test for `listByName`) — add this test alongside it, don't
replace the existing one:

```typescript
it("lists every brand for an organization, ordered by createdAt desc", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
  const created = await BrandsRepository.create(db, org.id, { name: "Linha Solar" });

  const list = await BrandsRepository.listByOrganization(db, org.id);
  expect(list.some((row) => row.id === created.id)).toBe(true);

  const [emptyOrg] = await db.insert(organizations).values({ name: "Empty Org" }).returning();
  const emptyList = await BrandsRepository.listByOrganization(db, emptyOrg.id);
  expect(emptyList).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/brands.repository.test.ts`
Expected: FAIL — `listByOrganization` doesn't exist.

- [ ] **Step 3: Implement `listByOrganization`**

```typescript
// src/repositories/brands.repository.ts
// Add `desc` to the existing `import { and, eq } from "drizzle-orm";` line:
import { and, desc, eq } from "drizzle-orm";

// Add inside the exported BrandsRepository object:
  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Brand[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(brands)
        .where(eq(brands.organizationId, organizationId))
        .orderBy(desc(brands.createdAt));
    });
  },
```

- [ ] **Step 4: Run the repository test to verify it passes**

Run: `pnpm vitest run src/repositories/brands.repository.test.ts`
Expected: PASS

- [ ] **Step 5: Implement `BrandService`**

```typescript
// src/services/brand.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { BrandsRepository, type Brand } from "@/repositories/brands.repository";

export const BrandService = {
  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Brand[]> {
    return BrandsRepository.listByOrganization(db, organizationId);
  },
};
```

- [ ] **Step 6: Write the failing route test**

```typescript
// src/app/api/brands/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { BrandsRepository } from "@/repositories/brands.repository";

describe("GET /api/brands", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the organization's brands", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const brand = await BrandsRepository.create(db, org.id, { name: "Linha Solar" });

    const { GET } = await import("./route");

    const request = new Request(`http://localhost/api/brands?organizationId=${org.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === brand.id)).toBe(true);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/brands/route.test.ts`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 8: Implement the route**

```typescript
// src/app/api/brands/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { BrandService } from "@/services/brand.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });
  const list = await BrandService.listByOrganization(db, payload.organizationId);
  return NextResponse.json(list, { status: 200 });
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/brands/route.test.ts`
Expected: PASS

- [ ] **Step 10: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/repositories/brands.repository.ts src/repositories/brands.repository.test.ts src/services/brand.service.ts src/app/api/brands
git commit -m "feat: add GET /api/brands"
```

---

## Self-Review

**Spec coverage:** the spec's single decision (mirror `GET /api/companies`) is fully covered
by Task 1; §3's out-of-scope list (detail route, POST, pagination, no change to
`listByName`/`create`) is correctly absent from the diff.

**Placeholder scan:** none — every step has literal, complete code.

**Type consistency:** `BrandsRepository.listByOrganization`/`BrandService.listByOrganization`
signatures match `CompaniesRepository`/`CompanyService`'s exactly (`(db, organizationId):
Promise<T[]>`).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-brands-list-api.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
