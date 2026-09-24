# Rate Card Items List API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /api/rate-card-items?organizationId=&creatorId=`, returning every currently
pickable priced item across a creator's rate cards, enriched with the linked Service's name — the
data the Proposal Builder's "Adicionar item" catalog Combobox needs.

**Architecture:** One new repository function (`RateCardItemsRepository.listByCreator`) joins
`rate_card_items` → `rate_cards` (to filter `isActive` and scope by `creatorId`) → `services` (to
filter `isActive` and pull `name`/`unitDescription`), ordered deterministically. A thin
`RateCardItemService.listByCreator` pass-through and a new `GET` handler in a new
`src/app/api/rate-card-items/route.ts` file complete the vertical slice — one task, since this is
a single cohesive read path with no natural split point.

**Tech Stack:** Next.js 16 Route Handlers, Drizzle ORM, Zod, Vitest, `withTestDb` test helper.

## Global Constraints

- `organizationId` and `creatorId` are both required query string params — mirrors the existing
  `GET /api/services` and `GET /api/rate-cards` pattern exactly (`src/app/api/services/route.ts`).
- Returned rows must include `serviceName: string` and a resolved `unitDescription: string | null`
  (the item's own `unitDescription` when non-null, otherwise falls back to the linked Service's
  `unitDescription`) — this resolution happens in the query/mapping, not left to the caller.
- Only items whose parent `rate_card.isActive = true` **and** whose linked `service.isActive =
  true` are returned — both must be active. An item on an archived rate card or belonging to a
  discontinued service must not appear, even though the row itself still exists (already-created
  proposals referencing it are unaffected — this endpoint only controls what's offered as a new
  pick).
- Ordered by `rateCardId, sortOrder, createdAt` — deterministic, same ordering discipline as the
  `proposal_items`/`proposal_blocks` fix from the prior mini-cycle.
- No pagination.
- No changes to any existing `POST`/`PATCH`/`DELETE` route or repository/service method in the
  Rate Cards or Services domains — additive only. In particular, `RateCardItemsRepository`'s
  existing `create`/`update`/`remove`/`findById`/`listByRateCard` methods (and their `WithTx`
  siblings) are untouched.

---

### Task 1: `GET /api/rate-card-items?organizationId=&creatorId=`

**Files:**
- Modify: `src/repositories/rate-card-items.repository.ts`
- Modify: `src/services/rate-card-item.service.ts`
- Create: `src/app/api/rate-card-items/route.ts`
- Test: `src/repositories/rate-card-items.repository.test.ts`
- Test: `src/services/rate-card-item.service.test.ts`
- Test: `src/app/api/rate-card-items/route.test.ts`

**Interfaces:**
- Consumes: `rateCardItems`, `rateCards` (from `src/db/schema/rate-cards.ts`), `services` (from
  `src/db/schema/services.ts`) — all already exported. `runInTenantContext` (from
  `./tenant-context`, already imported in the repository file).
- Produces: `RateCardItemWithService` type (`src/repositories/rate-card-items.repository.ts`) —
  every `RateCardItem` field except `unitDescription` is replaced by the resolved value, plus a
  new `serviceName: string` field:
  ```typescript
  export type RateCardItemWithService = Omit<RateCardItem, "unitDescription"> & {
    unitDescription: string | null;
    serviceName: string;
  };
  ```
  `RateCardItemsRepository.listByCreator(db, organizationId, creatorId): Promise<RateCardItemWithService[]>`
  — new export, plain-only (no `WithTx` sibling; mirrors `RateCardsRepository.listByCreator` and
  `ServicesRepository.listByCreator`, both of which are plain-only "flat creator-scoped list"
  reads with nothing composing them into a larger transaction).
  `RateCardItemService.listByCreator(db, organizationId, creatorId): Promise<RateCardItemWithService[]>`
  — new export on `RateCardItemService`, thin pass-through.
  `GET` handler exported from the new `src/app/api/rate-card-items/route.ts`.

- [ ] **Step 1: Write the failing repository test**

Read `src/repositories/rate-card-items.repository.test.ts` first — it inserts fixtures directly
(`organizations`, `users`, `creators`, `services`, `rateCards`) rather than via a shared `setup()`
helper; follow that same inline style. Add this new test to the file:

```typescript
it("listByCreator returns items enriched with service name, resolved unitDescription, only from active rate cards and active services", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
  const [user] = await db
    .insert(users)
    .values({ email: "thais@publyflow.test", fullName: "Thais" })
    .returning();
  const [creator] = await db
    .insert(creators)
    .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
    .returning();

  const [activeService] = await db
    .insert(services)
    .values({
      organizationId: org.id,
      creatorId: creator.id,
      name: "01 Reel",
      unitDescription: "por post",
    })
    .returning();
  const [inactiveService] = await db
    .insert(services)
    .values({ organizationId: org.id, creatorId: creator.id, name: "Story antigo", isActive: false })
    .returning();

  const [activeRateCard] = await db
    .insert(rateCards)
    .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela 2026" })
    .returning();
  const [inactiveRateCard] = await db
    .insert(rateCards)
    .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela 2024", isActive: false })
    .returning();

  // Visible: active rate card + active service, no own unitDescription -> falls back to service's.
  await RateCardItemsRepository.create(db, org.id, {
    rateCardId: activeRateCard.id,
    serviceId: activeService.id,
    price: 200000,
    sortOrder: 10,
  });
  // Visible: active rate card + active service, own unitDescription overrides service's.
  await RateCardItemsRepository.create(db, org.id, {
    rateCardId: activeRateCard.id,
    serviceId: activeService.id,
    price: 150000,
    unitDescription: "pacote de 3",
    sortOrder: 5,
  });
  // Hidden: rate card is inactive.
  await RateCardItemsRepository.create(db, org.id, {
    rateCardId: inactiveRateCard.id,
    serviceId: activeService.id,
    price: 999999,
  });
  // Hidden: service is inactive.
  await RateCardItemsRepository.create(db, org.id, {
    rateCardId: activeRateCard.id,
    serviceId: inactiveService.id,
    price: 999999,
  });

  const items = await RateCardItemsRepository.listByCreator(db, org.id, creator.id);

  expect(items).toHaveLength(2);
  // sortOrder 5 comes before sortOrder 10.
  expect(items[0].price).toBe(150000);
  expect(items[0].unitDescription).toBe("pacote de 3");
  expect(items[0].serviceName).toBe("01 Reel");
  expect(items[1].price).toBe(200000);
  expect(items[1].unitDescription).toBe("por post");
  expect(items[1].serviceName).toBe("01 Reel");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/rate-card-items.repository.test.ts`
Expected: FAIL — `RateCardItemsRepository.listByCreator` is not a function.

- [ ] **Step 3: Implement `RateCardItemsRepository.listByCreator`**

Read the current content of `src/repositories/rate-card-items.repository.ts` first. Add the
`RateCardItemWithService` type near the top (right after the existing `RateCardItem` type
export), add the two new schema imports, and add the new method to the `RateCardItemsRepository`
object (after `listByRateCardWithTx`, the last method):

```typescript
// Add to the top-level imports:
import { and, asc, eq } from "drizzle-orm";
import { rateCards } from "@/db/schema/rate-cards";
import { services } from "@/db/schema/services";

// Add after the existing `RateCardItem` type export:
export type RateCardItemWithService = Omit<RateCardItem, "unitDescription"> & {
  unitDescription: string | null;
  serviceName: string;
};

// Add after `selectRateCardItemsByRateCard` (a new sibling private function):
async function selectRateCardItemsByCreator(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  creatorId: string,
): Promise<RateCardItemWithService[]> {
  const rows = await tx
    .select({
      item: rateCardItems,
      serviceName: services.name,
      serviceUnitDescription: services.unitDescription,
    })
    .from(rateCardItems)
    .innerJoin(
      rateCards,
      and(eq(rateCards.id, rateCardItems.rateCardId), eq(rateCards.isActive, true)),
    )
    .innerJoin(
      services,
      and(eq(services.id, rateCardItems.serviceId), eq(services.isActive, true)),
    )
    .where(and(eq(rateCardItems.organizationId, organizationId), eq(rateCards.creatorId, creatorId)))
    .orderBy(asc(rateCardItems.rateCardId), asc(rateCardItems.sortOrder), asc(rateCardItems.createdAt));

  return rows.map((row) => ({
    ...row.item,
    unitDescription: row.item.unitDescription ?? row.serviceUnitDescription,
    serviceName: row.serviceName,
  }));
}

// Add to the exported RateCardItemsRepository object, after listByRateCardWithTx:
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<RateCardItemWithService[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectRateCardItemsByCreator(tx, organizationId, creatorId),
    );
  },
```

Note the file's existing `import { and, eq } from "drizzle-orm";` line becomes
`import { and, asc, eq } from "drizzle-orm";` — don't duplicate the import, just add `asc`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/rate-card-items.repository.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Write the failing service test**

Read `src/services/rate-card-item.service.test.ts` first to match its existing style, then add:

```typescript
it("listByCreator delegates to the repository", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
  const [user] = await db
    .insert(users)
    .values({ email: "thais@publyflow.test", fullName: "Thais" })
    .returning();
  const [creator] = await db
    .insert(creators)
    .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
    .returning();
  const [service] = await db
    .insert(services)
    .values({ organizationId: org.id, creatorId: creator.id, name: "01 Reel" })
    .returning();
  const [rateCard] = await db
    .insert(rateCards)
    .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela 2026" })
    .returning();

  await RateCardItemService.addItem(db, org.id, {
    rateCardId: rateCard.id,
    serviceId: service.id,
    price: 200000,
  });

  const items = await RateCardItemService.listByCreator(db, org.id, creator.id);
  expect(items).toHaveLength(1);
  expect(items[0].serviceName).toBe("01 Reel");
});
```

Check the file's existing imports first — it likely already imports `organizations`, `users`,
`creators`, `services`, `rateCards`, `RateCardItemService` from testing the other methods in this
same file; reuse them, only add what's missing (e.g. if `services`/`rateCards` schema imports
aren't already present for some reason).

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/services/rate-card-item.service.test.ts`
Expected: FAIL — `RateCardItemService.listByCreator` is not a function.

- [ ] **Step 7: Implement `RateCardItemService.listByCreator`**

In `src/services/rate-card-item.service.ts`, add `RateCardItemWithService` to the existing
`import { RateCardItemsRepository, type RateCardItem, ... } from "@/repositories/rate-card-items.repository";`
line, and add this method to the `RateCardItemService` object (after `removeItem`, the last
method — thin pass-through, no `assertNotLocked` needed since this is a read, not a write against
a specific rate card):

```typescript
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<RateCardItemWithService[]> {
    return RateCardItemsRepository.listByCreator(db, organizationId, creatorId);
  },
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/services/rate-card-item.service.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 9: Write the failing route test**

Create `src/app/api/rate-card-items/route.test.ts` (this directory currently has no
collection-level `route.ts`/`route.test.ts` — only `[id]/route.ts` exists):

```typescript
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { services } from "@/db/schema/services";
import { rateCards } from "@/db/schema/rate-cards";
import { RateCardItemService } from "@/services/rate-card-item.service";

describe("GET /api/rate-card-items", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with items enriched with service name", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [service] = await db
      .insert(services)
      .values({ organizationId: org.id, creatorId: creator.id, name: "01 Reel" })
      .returning();
    const [rateCard] = await db
      .insert(rateCards)
      .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela 2026" })
      .returning();

    await RateCardItemService.addItem(db, org.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    const { GET } = await import("./route");
    const request = new Request(
      `http://localhost/api/rate-card-items?organizationId=${org.id}&creatorId=${creator.id}`,
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toHaveLength(1);
    expect(json[0].serviceName).toBe("01 Reel");
    expect(json[0].price).toBe(200000);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/rate-card-items/route.test.ts`
Expected: FAIL — the file `./route` does not exist.

- [ ] **Step 11: Implement the `GET` route handler**

Create `src/app/api/rate-card-items/route.ts`, mirroring `src/app/api/services/route.ts`'s `GET`
handler exactly (same query schema shape, same URL parsing) — this file has no `POST` (item
creation stays at `POST /api/rate-cards/:id/items`, unchanged):

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardItemService } from "@/services/rate-card-item.service";

const listQuerySchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = listQuerySchema.parse({
    organizationId: url.searchParams.get("organizationId"),
    creatorId: url.searchParams.get("creatorId"),
  });
  const items = await RateCardItemService.listByCreator(db, payload.organizationId, payload.creatorId);
  return NextResponse.json(items, { status: 200 });
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/rate-card-items/route.test.ts`
Expected: PASS

- [ ] **Step 13: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/repositories/rate-card-items.repository.ts src/repositories/rate-card-items.repository.test.ts src/services/rate-card-item.service.ts src/services/rate-card-item.service.test.ts src/app/api/rate-card-items/route.ts src/app/api/rate-card-items/route.test.ts
git commit -m "feat: add GET /api/rate-card-items with service enrichment"
```

---

## Self-Review

**Spec coverage:**
- Decisão #1 (endpoint agregado por creator) — Task 1, the route takes `creatorId`, not a
  `rateCardId`.
- Decisão #2 (campos: bare fields + `serviceName` + resolved `unitDescription`) —
  `RateCardItemWithService` type and the mapping in `selectRateCardItemsByCreator` implement this
  exactly; the repository test's two "visible" items specifically assert both the fallback case
  (no own `unitDescription`) and the override case (own `unitDescription` set).
- Decisão #3 (filtro: rate card ativo E service ativo) — both `innerJoin`s carry an `isActive`
  condition; the repository test's two "hidden" fixtures (inactive rate card, inactive service)
  assert exactly this, alongside the two visible ones, in the same test.
- Decisão #4 (repository: `INNER JOIN` ambos, ordenado por `rate_card_id, sort_order,
  created_at`) — implemented exactly as specified in Step 3; the repository test's two visible
  items use `sortOrder: 10` and `sortOrder: 5` specifically to prove the ordering isn't just
  insertion order.
- Decisão #5 (service: pass-through simples) — Step 7's `listByCreator` has no additional logic.
- Decisão #6 (sem mudanças de escrita) — no task touches any `POST`/`PATCH`/`DELETE` handler or
  the existing `create`/`update`/`remove` repository or service methods.
- "Fora de escopo" (sem paginação, sem busca client-side no backend, sem mudança em `lock`/
  `duplicate`, sem mudança em `ProposalItemService.addItem`) — none introduced by this task.

**Placeholder scan:** none — every step has literal, complete code.

**Type consistency:** `RateCardItemWithService` is defined once (repository) and reused by name
in the service's return type — never redefined. `listByCreator`'s parameter list
(`db, organizationId, creatorId`) matches the sibling `RateCardsRepository.listByCreator`/
`ServicesRepository.listByCreator` signatures exactly, and is threaded identically through the
service layer and the route.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-23-rate-card-items-list.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
