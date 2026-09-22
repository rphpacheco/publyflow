# Services & Rate Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the per-creator Services catalog and versioned Rate Cards subsystem
(`services`, `rate_cards`, `rate_card_items`), the direct dependency of the upcoming
Proposals plan, per
`docs/superpowers/specs/2026-09-21-services-and-rate-cards-design.md`.

**Architecture:** Same layering already established on `main`:
`db/schema` → `repositories` (via `runInTenantContext`) → `services` (domain rules) →
`app/api` (thin Route Handlers). RLS is enabled in the SAME task that creates each table —
the final whole-branch review of the previous plan found RLS deferred to a separate task
gets silently skipped for later tables, so this plan never separates "add table" from
"enable RLS on it" again.

**Tech Stack:** Next.js 16 (Route Handlers), Drizzle ORM, PostgreSQL (RLS), Zod, Vitest.

## Global Constraints

- Every domain table carries `organization_id` with RLS enabled in the same migration that
  creates the table — no exceptions, no follow-up task (spec §3, Global Constraint carried
  over from the prior plan's final-review finding).
- `services` and `rate_cards` are scoped **per creator** (`creator_id` not null) — not
  shared across an organization's creators (spec Decisão #3/#4).
- Rate Cards are **immutable once locked** (`is_locked`): any write to `rate_card_items`
  for a locked Rate Card must throw `RateCardLockedError`, never silently no-op or succeed
  (spec Decisão #1).
- Rate Card selection is always explicit — no auto-default table logic in this plan (spec
  Decisão #2). `valid_from`/`valid_to` are informational metadata only, never used to
  auto-select or auto-filter (spec Decisão #6).
- No hard-delete of `services` — deactivate via `is_active: false` only (spec §4).
- `service_packages` (combos), `is_default`, and a `DRAFT`/`PUBLISHED`/`LOCKED` state
  machine are explicitly out of scope for this plan (spec Decisão #8).

---

## File Structure

```
src/
  db/
    schema/
      services.ts                          # services table
      rate-cards.ts                         # rate_cards, rate_card_items tables
      index.ts                              # modify: barrel re-export
    migrations/
      0007_add_services.sql
      0008_add_rate_cards.sql
      0009_add_rate_card_items.sql
  domain/
    rate-cards/
      errors.ts                             # RateCardLockedError
  repositories/
    services.repository.ts                  # ServicesRepository
    rate-cards.repository.ts                # RateCardsRepository
    rate-card-items.repository.ts           # RateCardItemsRepository
  services/
    service.service.ts                      # ServiceService
    rate-card.service.ts                    # RateCardService
    rate-card-item.service.ts               # RateCardItemService
  app/
    api/
      services/
        route.ts                            # POST, GET
        [id]/route.ts                       # PATCH
      rate-cards/
        route.ts                            # POST, GET
        [id]/
          duplicate/route.ts                # POST
          items/route.ts                    # POST
      rate-card-items/
        [id]/route.ts                       # PATCH, DELETE
  test/
    helpers/
      db.ts                                 # modify: extend DOMAIN_TABLES
```

---

### Task 1: Schema — `services` (with RLS from the start)

**Files:**
- Create: `src/db/schema/services.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/test/helpers/db.ts` (prepend `"services"` to `DOMAIN_TABLES`)
- Test: `src/db/schema/services.test.ts`
- Test: `src/db/rls-services.test.ts`

**Interfaces:**
- Produces: `services` Drizzle table from `src/db/schema/services.ts` — `id`,
  `organizationId`, `creatorId`, `name`, `description` (nullable), `unitDescription`
  (nullable), `isActive` (boolean, default `true`), `createdAt`.

- [ ] **Step 1: Write the failing schema test**

```typescript
// src/db/schema/services.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { services } from "./services";

describe("services schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("stores a service scoped to organization and creator, defaulting isActive true", async () => {
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
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        name: "01 Reel",
        description: "Reel patrocinado no feed",
        unitDescription: "por publicação",
      })
      .returning();

    expect(service.organizationId).toBe(org.id);
    expect(service.creatorId).toBe(creator.id);
    expect(service.isActive).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/services.test.ts`
Expected: FAIL — `./services` doesn't exist.

- [ ] **Step 3: Implement the schema**

```typescript
// src/db/schema/services.ts
import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { creators } from "./creators";

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  unitDescription: text("unit_description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Register in the barrel, generate the migration**

```typescript
// src/db/schema/index.ts
export * from "./organizations";
export * from "./creators";
export * from "./companies-brands-contacts";
export * from "./conversations-messages";
export * from "./commercial-flow";
export * from "./services";
```

Run:
```bash
pnpm drizzle-kit generate --name add_services
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

This creates `src/db/migrations/0007_add_services.sql` (exact content generated by
drizzle-kit from the schema above — don't hand-write it).

- [ ] **Step 5: Hand-append RLS to the generated migration, in the SAME migration file**

Open `src/db/migrations/0007_add_services.sql` (the file drizzle-kit just generated) and
append this to the end of it:

```sql

-- Hand-appended (not drizzle-generated): RLS enabled in the same migration
-- that creates the table, per the Global Constraint carried over from the
-- previous plan's final-review finding (RLS deferred to a later task gets
-- silently skipped). Same convention as 0002_rls_core.sql: policy checks
-- app.current_org_id, set per-request by runInTenantContext.
alter table services enable row level security;

create policy org_isolation_services on services
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
```

Re-apply the migration so the RLS statements take effect:
```bash
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

- [ ] **Step 6: Extend `DOMAIN_TABLES` in the test helper**

```typescript
// src/test/helpers/db.ts — add "services" to the DOMAIN_TABLES array,
// before "opportunity_stage_history" (order doesn't matter functionally —
// truncate uses CASCADE — but keep it readable, children before parents):
const DOMAIN_TABLES = [
  "services",
  "opportunity_stage_history",
  "opportunities",
  "leads",
  "commercial_inquiries",
  "messages",
  "contacts",
  "brands",
  "companies",
  "organization_members",
  "conversations",
  "creators",
  "users",
  "organizations",
] as const;
```

- [ ] **Step 7: Run the schema test to verify it passes**

Run: `pnpm vitest run src/db/schema/services.test.ts`
Expected: PASS

- [ ] **Step 8: Write the RLS isolation test**

```typescript
// src/db/rls-services.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { organizations, users } from "./schema/organizations";
import { creators } from "./schema/creators";
import { services } from "./schema/services";

describe("RLS on services", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns services belonging to the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [orgA] = await db.insert(organizations).values({ name: "Org A" }).returning();
    const [orgB] = await db.insert(organizations).values({ name: "Org B" }).returning();
    const [userA] = await db
      .insert(users)
      .values({ email: "a@publyflow.test", fullName: "User A" })
      .returning();
    const [userB] = await db
      .insert(users)
      .values({ email: "b@publyflow.test", fullName: "User B" })
      .returning();
    const [creatorA] = await db
      .insert(creators)
      .values({ organizationId: orgA.id, userId: userA.id, displayName: "Creator A" })
      .returning();
    const [creatorB] = await db
      .insert(creators)
      .values({ organizationId: orgB.id, userId: userB.id, displayName: "Creator B" })
      .returning();

    await db.insert(services).values({
      organizationId: orgA.id,
      creatorId: creatorA.id,
      name: "Service A",
    });
    await db.insert(services).values({
      organizationId: orgB.id,
      creatorId: creatorB.id,
      name: "Service B",
    });

    const appDb = getAppUserDb();
    const visible = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${orgA.id}, true)`);
      return tx.select().from(services);
    });

    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe("Service A");
  });
});
```

- [ ] **Step 9: Run the RLS test to verify it passes**

Run: `pnpm vitest run src/db/rls-services.test.ts`
Expected: PASS

- [ ] **Step 10: Run the full suite, then commit**

Run: `pnpm test`
Expected: all pass, no regressions.

```bash
git add src/db src/test
git commit -m "feat: add services schema with RLS from creation"
```

---

### Task 2: Schema — `rate_cards` (with RLS from the start)

**Files:**
- Create: `src/db/schema/rate-cards.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/test/helpers/db.ts`
- Test: `src/db/schema/rate-cards.test.ts`
- Test: `src/db/rls-rate-cards.test.ts`

**Interfaces:**
- Produces: `rateCards` Drizzle table from `src/db/schema/rate-cards.ts` — `id`,
  `organizationId`, `creatorId`, `name`, `isActive` (boolean, default `true`), `isLocked`
  (boolean, default `false`), `validFrom` (timestamp, nullable), `validTo` (timestamp,
  nullable), `createdAt`.

- [ ] **Step 1: Write the failing schema test**

```typescript
// src/db/schema/rate-cards.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { rateCards } from "./rate-cards";

describe("rate_cards schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("stores a rate card scoped to organization and creator, defaulting isActive true and isLocked false", async () => {
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

    const [rateCard] = await db
      .insert(rateCards)
      .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela 2026" })
      .returning();

    expect(rateCard.isActive).toBe(true);
    expect(rateCard.isLocked).toBe(false);
    expect(rateCard.validFrom).toBeNull();
    expect(rateCard.validTo).toBeNull();
  });

  it("accepts an explicit validFrom/validTo window", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais2@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();

    const validFrom = new Date("2026-11-20T00:00:00Z");
    const validTo = new Date("2026-11-30T23:59:59Z");

    const [rateCard] = await db
      .insert(rateCards)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        name: "Tabela Black Friday",
        validFrom,
        validTo,
      })
      .returning();

    expect(rateCard.validFrom).toEqual(validFrom);
    expect(rateCard.validTo).toEqual(validTo);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/rate-cards.test.ts`
Expected: FAIL — `./rate-cards` doesn't exist.

- [ ] **Step 3: Implement the schema**

```typescript
// src/db/schema/rate-cards.ts
import { pgTable, uuid, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { creators } from "./creators";
import { services } from "./services";

export const rateCards = pgTable("rate_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isLocked: boolean("is_locked").notNull().default(false),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validTo: timestamp("valid_to", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateCardItems = pgTable("rate_card_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  rateCardId: uuid("rate_card_id")
    .notNull()
    .references(() => rateCards.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "restrict" }),
  price: integer("price").notNull(),
  unitDescription: text("unit_description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Note: `rateCardItems` is defined in this same file (not a separate `rate-card-items.ts`)
because it references `rateCards` directly and the two tables are small enough that
splitting them would just add an import hop with no isolation benefit — this mirrors how
`companies-brands-contacts.ts` groups three small, tightly-related tables in one file. Task
3 below only adds the migration + tests for `rate_card_items`; the schema itself is already
complete after this task.

- [ ] **Step 4: Register in the barrel, generate the migration**

```typescript
// src/db/schema/index.ts
export * from "./organizations";
export * from "./creators";
export * from "./companies-brands-contacts";
export * from "./conversations-messages";
export * from "./commercial-flow";
export * from "./services";
export * from "./rate-cards";
```

Run:
```bash
pnpm drizzle-kit generate --name add_rate_cards
```

This will generate ONE migration containing both `rate_cards` and `rate_card_items` (since
both are new tables in the schema diff) — that's fine, name it `0008_add_rate_cards.sql`
(drizzle-kit picks the filename automatically based on `--name`).

Apply it:
```bash
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

- [ ] **Step 5: Hand-append RLS for `rate_cards` only (not `rate_card_items` yet — that's Task 3)**

Append to the end of the just-generated `src/db/migrations/0008_add_rate_cards.sql`:

```sql

-- Hand-appended (not drizzle-generated): RLS for rate_cards, enabled in
-- the same migration that creates the table. rate_card_items gets its own
-- RLS policy in Task 3's migration, once its dedicated test exists —
-- enabling it here too is harmless, but keeping each table's RLS grouped
-- with the task that adds its test keeps the audit trail clean per table.
alter table rate_cards enable row level security;

create policy org_isolation_rate_cards on rate_cards
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
```

Re-apply:
```bash
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

- [ ] **Step 6: Extend `DOMAIN_TABLES`**

```typescript
// src/test/helpers/db.ts
const DOMAIN_TABLES = [
  "rate_card_items",
  "rate_cards",
  "services",
  "opportunity_stage_history",
  "opportunities",
  "leads",
  "commercial_inquiries",
  "messages",
  "contacts",
  "brands",
  "companies",
  "organization_members",
  "conversations",
  "creators",
  "users",
  "organizations",
] as const;
```

(`rate_card_items` is listed here now even though its RLS/test lands in Task 3 — the
42P01-swallow guard in `withTestDb()`'s cleanup already tolerates a not-yet-existent table,
same pattern used throughout the previous plan.)

- [ ] **Step 7: Run the schema test to verify it passes**

Run: `pnpm vitest run src/db/schema/rate-cards.test.ts`
Expected: PASS (both tests)

- [ ] **Step 8: Write the RLS isolation test**

```typescript
// src/db/rls-rate-cards.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { organizations, users } from "./schema/organizations";
import { creators } from "./schema/creators";
import { rateCards } from "./schema/rate-cards";

describe("RLS on rate_cards", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns rate cards belonging to the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [orgA] = await db.insert(organizations).values({ name: "Org A" }).returning();
    const [orgB] = await db.insert(organizations).values({ name: "Org B" }).returning();
    const [userA] = await db
      .insert(users)
      .values({ email: "a@publyflow.test", fullName: "User A" })
      .returning();
    const [userB] = await db
      .insert(users)
      .values({ email: "b@publyflow.test", fullName: "User B" })
      .returning();
    const [creatorA] = await db
      .insert(creators)
      .values({ organizationId: orgA.id, userId: userA.id, displayName: "Creator A" })
      .returning();
    const [creatorB] = await db
      .insert(creators)
      .values({ organizationId: orgB.id, userId: userB.id, displayName: "Creator B" })
      .returning();

    await db.insert(rateCards).values({
      organizationId: orgA.id,
      creatorId: creatorA.id,
      name: "Tabela A",
    });
    await db.insert(rateCards).values({
      organizationId: orgB.id,
      creatorId: creatorB.id,
      name: "Tabela B",
    });

    const appDb = getAppUserDb();
    const visible = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${orgA.id}, true)`);
      return tx.select().from(rateCards);
    });

    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe("Tabela A");
  });
});
```

- [ ] **Step 9: Run the RLS test to verify it passes**

Run: `pnpm vitest run src/db/rls-rate-cards.test.ts`
Expected: PASS

- [ ] **Step 10: Run the full suite, then commit**

Run: `pnpm test`
Expected: all pass.

```bash
git add src/db src/test
git commit -m "feat: add rate_cards schema (and rate_card_items table) with RLS on rate_cards"
```

---

### Task 3: Schema RLS + tests for `rate_card_items`

**Files:**
- Create: `src/db/migrations/0009_add_rate_card_items_rls.sql` (hand-written)
- Test: `src/db/schema/rate-card-items.test.ts`
- Test: `src/db/rls-rate-card-items.test.ts`

**Interfaces:**
- Consumes: `rateCardItems` table from `src/db/schema/rate-cards.ts` (Task 2 — already
  created there; this task only adds RLS + tests for it, since its schema definition
  shipped alongside `rateCards` in Task 2 for file-locality reasons).

- [ ] **Step 1: Write the failing schema test**

```typescript
// src/db/schema/rate-card-items.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { services } from "./services";
import { rateCards, rateCardItems } from "./rate-cards";

describe("rate_card_items schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("stores an item linked to a rate card and a service, with sortOrder defaulting to 0", async () => {
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

    const [item] = await db
      .insert(rateCardItems)
      .values({
        organizationId: org.id,
        rateCardId: rateCard.id,
        serviceId: service.id,
        price: 200000,
      })
      .returning();

    expect(item.rateCardId).toBe(rateCard.id);
    expect(item.serviceId).toBe(service.id);
    expect(item.price).toBe(200000);
    expect(item.sortOrder).toBe(0);
  });

  it("rejects deleting a service that is referenced by a rate card item", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais2@publyflow.test", fullName: "Thais" })
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
    await db.insert(rateCardItems).values({
      organizationId: org.id,
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    const { eq } = await import("drizzle-orm");
    await expect(db.delete(services).where(eq(services.id, service.id))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/rate-card-items.test.ts`
Expected: FAIL — `rate_card_items` table doesn't have data yet / no RLS policy interferes,
but more importantly this proves the `restrict` FK behavior; if it unexpectedly passes at
this point (schema already exists from Task 2), that's fine — this step still confirms
correctness. If Task 2 already fully covers table creation, this is effectively the first
RED for the RLS test below, not this one. Proceed regardless.

- [ ] **Step 3: Run it to confirm it now passes (schema already exists from Task 2)**

Run: `pnpm vitest run src/db/schema/rate-card-items.test.ts`
Expected: PASS (both tests) — the table and FK constraint already exist from Task 2's
migration; this task's job is RLS + isolation test, added next.

- [ ] **Step 4: Write the failing RLS isolation test**

```typescript
// src/db/rls-rate-card-items.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { organizations, users } from "./schema/organizations";
import { creators } from "./schema/creators";
import { services } from "./schema/services";
import { rateCards, rateCardItems } from "./schema/rate-cards";

describe("RLS on rate_card_items", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns rate card items belonging to the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [orgA] = await db.insert(organizations).values({ name: "Org A" }).returning();
    const [orgB] = await db.insert(organizations).values({ name: "Org B" }).returning();
    const [userA] = await db
      .insert(users)
      .values({ email: "a@publyflow.test", fullName: "User A" })
      .returning();
    const [userB] = await db
      .insert(users)
      .values({ email: "b@publyflow.test", fullName: "User B" })
      .returning();
    const [creatorA] = await db
      .insert(creators)
      .values({ organizationId: orgA.id, userId: userA.id, displayName: "Creator A" })
      .returning();
    const [creatorB] = await db
      .insert(creators)
      .values({ organizationId: orgB.id, userId: userB.id, displayName: "Creator B" })
      .returning();
    const [serviceA] = await db
      .insert(services)
      .values({ organizationId: orgA.id, creatorId: creatorA.id, name: "Service A" })
      .returning();
    const [serviceB] = await db
      .insert(services)
      .values({ organizationId: orgB.id, creatorId: creatorB.id, name: "Service B" })
      .returning();
    const [rateCardA] = await db
      .insert(rateCards)
      .values({ organizationId: orgA.id, creatorId: creatorA.id, name: "Tabela A" })
      .returning();
    const [rateCardB] = await db
      .insert(rateCards)
      .values({ organizationId: orgB.id, creatorId: creatorB.id, name: "Tabela B" })
      .returning();

    await db.insert(rateCardItems).values({
      organizationId: orgA.id,
      rateCardId: rateCardA.id,
      serviceId: serviceA.id,
      price: 100000,
    });
    await db.insert(rateCardItems).values({
      organizationId: orgB.id,
      rateCardId: rateCardB.id,
      serviceId: serviceB.id,
      price: 200000,
    });

    const appDb = getAppUserDb();
    const visible = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${orgA.id}, true)`);
      return tx.select().from(rateCardItems);
    });

    expect(visible).toHaveLength(1);
    expect(visible[0].price).toBe(100000);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm vitest run src/db/rls-rate-card-items.test.ts`
Expected: FAIL — 2 rows returned instead of 1 (RLS not enabled on `rate_card_items` yet).

- [ ] **Step 6: Write the RLS migration**

```sql
-- src/db/migrations/0009_add_rate_card_items_rls.sql
alter table rate_card_items enable row level security;

create policy org_isolation_rate_card_items on rate_card_items
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
```

Apply it:
```bash
psql "$TEST_DATABASE_URL" -f src/db/migrations/0009_add_rate_card_items_rls.sql
```

Also add a corresponding entry to `src/db/migrations/meta/_journal.json` (append an entry
for `0009_add_rate_card_items_rls`, following the exact shape of the existing entries —
check `meta/_journal.json`'s current last entry for the format) so `drizzle-kit migrate`
recognizes this hand-written migration as applied, matching how `0002_rls_core.sql` and
`0006_add_org_id_to_stage_history_and_rls.sql` were registered (check `git log -p` on those
migrations' commits if the journal format isn't obvious from reading the current file).

- [ ] **Step 7: Run the RLS test to verify it passes**

Run: `pnpm vitest run src/db/rls-rate-card-items.test.ts`
Expected: PASS

- [ ] **Step 8: Run the full suite, then commit**

Run: `pnpm test`
Expected: all pass.

```bash
git add src/db
git commit -m "feat: enable RLS on rate_card_items"
```

---

### Task 4: Domain error — `RateCardLockedError`

**Files:**
- Create: `src/domain/rate-cards/errors.ts`

**Interfaces:**
- Produces: `RateCardLockedError` from `src/domain/rate-cards/errors.ts`, thrown by
  `RateCardItemService` (Task 10) whenever a write targets a locked Rate Card.

- [ ] **Step 1: Implement the error**

```typescript
// src/domain/rate-cards/errors.ts
// Thrown by RateCardItemService.addItem/updateItem/removeItem when the
// parent Rate Card has isLocked === true. Rate Cards become immutable
// once any of their items is copied into a Proposal (per design spec
// Decisão #1) — the lock itself is set by RateCardService.lock(), called
// by the future Proposals subsystem, not by anything in this plan.
export class RateCardLockedError extends Error {
  constructor(rateCardId: string) {
    super(`Rate card ${rateCardId} is locked and cannot be modified`);
    this.name = "RateCardLockedError";
  }
}
```

There is no test for this task in isolation — it's exercised by Task 10's tests. This step
alone has no RED/GREEN cycle since it's a pure data-only class; commit it directly.

- [ ] **Step 2: Commit**

```bash
git add src/domain/rate-cards
git commit -m "feat: add RateCardLockedError domain error"
```

---

### Task 5: `ServicesRepository`

**Files:**
- Create: `src/repositories/services.repository.ts`
- Test: `src/repositories/services.repository.test.ts`

**Interfaces:**
- Produces: `Service` type and `ServicesRepository.create(db, organizationId, input: { creatorId: string; name: string; description?: string | null; unitDescription?: string | null }): Promise<Service>`, `ServicesRepository.update(db, organizationId, serviceId: string, input: { name?: string; description?: string | null; unitDescription?: string | null; isActive?: boolean }): Promise<Service>`, `ServicesRepository.listByCreator(db, organizationId, creatorId: string): Promise<Service[]>` from
  `src/repositories/services.repository.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/repositories/services.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { ServicesRepository } from "./services.repository";

describe("ServicesRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a service, updates it, and lists only the creator's active+inactive services", async () => {
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

    const created = await ServicesRepository.create(db, org.id, {
      creatorId: creator.id,
      name: "01 Reel",
      description: "Reel patrocinado",
    });

    expect(created.name).toBe("01 Reel");

    const updated = await ServicesRepository.update(db, org.id, created.id, {
      isActive: false,
    });

    expect(updated.isActive).toBe(false);

    const list = await ServicesRepository.listByCreator(db, org.id, creator.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/services.repository.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the repository**

```typescript
// src/repositories/services.repository.ts
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { services } from "@/db/schema/services";
import { runInTenantContext } from "./tenant-context";

export type Service = typeof services.$inferSelect;

export interface CreateServiceInput {
  creatorId: string;
  name: string;
  description?: string | null;
  unitDescription?: string | null;
}

export interface UpdateServiceInput {
  name?: string;
  description?: string | null;
  unitDescription?: string | null;
  isActive?: boolean;
}

export const ServicesRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateServiceInput,
  ): Promise<Service> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [service] = await tx
        .insert(services)
        .values({
          organizationId,
          creatorId: input.creatorId,
          name: input.name,
          description: input.description ?? null,
          unitDescription: input.unitDescription ?? null,
        })
        .returning();
      return service;
    });
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    serviceId: string,
    input: UpdateServiceInput,
  ): Promise<Service> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [service] = await tx
        .update(services)
        .set(input)
        .where(and(eq(services.id, serviceId), eq(services.organizationId, organizationId)))
        .returning();
      return service;
    });
  },

  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<Service[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(services)
        .where(and(eq(services.organizationId, organizationId), eq(services.creatorId, creatorId)));
    });
  },
};
```

Note the explicit `eq(services.organizationId, organizationId)` AND-condition on `update`
and `listByCreator`, even though RLS already enforces this — this is the defense-in-depth
pattern the previous plan's final review required (belt-and-suspenders, not a substitute
for RLS).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/services.repository.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repositories
git commit -m "feat: add ServicesRepository"
```

---

### Task 6: `ServiceService`

**Files:**
- Create: `src/services/service.service.ts`
- Test: `src/services/service.service.test.ts`

**Interfaces:**
- Consumes: `ServicesRepository` (Task 5).
- Produces: `ServiceService.create(db, organizationId, input: CreateServiceInput): Promise<Service>`, `ServiceService.update(db, organizationId, serviceId: string, input: UpdateServiceInput): Promise<Service>`, `ServiceService.deactivate(db, organizationId, serviceId: string): Promise<Service>`, `ServiceService.listByCreator(db, organizationId, creatorId: string): Promise<Service[]>` from
  `src/services/service.service.ts`. There is deliberately **no `delete` method** anywhere
  in this service — hard-delete of a Service is out of scope per spec §4; `deactivate` is
  the only removal path.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/service.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ServiceService } from "./service.service";

describe("ServiceService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates, updates, and deactivates a service", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const created = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "01 Reel",
    });

    const updated = await ServiceService.update(db, organization.id, created.id, {
      description: "Reel patrocinado",
    });
    expect(updated.description).toBe("Reel patrocinado");

    const deactivated = await ServiceService.deactivate(db, organization.id, created.id);
    expect(deactivated.isActive).toBe(false);

    const list = await ServiceService.listByCreator(db, organization.id, creator.id);
    expect(list).toHaveLength(1);
    expect(list[0].isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/service.service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the service**

```typescript
// src/services/service.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  ServicesRepository,
  type Service,
  type CreateServiceInput,
  type UpdateServiceInput,
} from "@/repositories/services.repository";

export const ServiceService = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateServiceInput,
  ): Promise<Service> {
    return ServicesRepository.create(db, organizationId, input);
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    serviceId: string,
    input: UpdateServiceInput,
  ): Promise<Service> {
    return ServicesRepository.update(db, organizationId, serviceId, input);
  },

  async deactivate(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    serviceId: string,
  ): Promise<Service> {
    return ServicesRepository.update(db, organizationId, serviceId, { isActive: false });
  },

  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<Service[]> {
    return ServicesRepository.listByCreator(db, organizationId, creatorId);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/service.service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services
git commit -m "feat: add ServiceService"
```

---

### Task 7: `RateCardsRepository`

**Files:**
- Create: `src/repositories/rate-cards.repository.ts`
- Test: `src/repositories/rate-cards.repository.test.ts`

**Interfaces:**
- Produces: `RateCard` type and `RateCardsRepository.create(db, organizationId, input: { creatorId: string; name: string; validFrom?: Date | null; validTo?: Date | null }): Promise<RateCard>`, `RateCardsRepository.findById(db, organizationId, rateCardId: string): Promise<RateCard | null>`, `RateCardsRepository.listByCreator(db, organizationId, creatorId: string): Promise<RateCard[]>`, `RateCardsRepository.setLocked(db, organizationId, rateCardId: string, locked: boolean): Promise<RateCard>` from
  `src/repositories/rate-cards.repository.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/repositories/rate-cards.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { RateCardsRepository } from "./rate-cards.repository";

describe("RateCardsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a rate card, finds it by id, lists by creator, and locks it", async () => {
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

    const created = await RateCardsRepository.create(db, org.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });

    expect(created.isLocked).toBe(false);

    const found = await RateCardsRepository.findById(db, org.id, created.id);
    expect(found?.id).toBe(created.id);

    const list = await RateCardsRepository.listByCreator(db, org.id, creator.id);
    expect(list).toHaveLength(1);

    const locked = await RateCardsRepository.setLocked(db, org.id, created.id, true);
    expect(locked.isLocked).toBe(true);
  });

  it("returns null from findById for a nonexistent id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();

    const found = await RateCardsRepository.findById(
      db,
      org.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/rate-cards.repository.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the repository**

```typescript
// src/repositories/rate-cards.repository.ts
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { rateCards } from "@/db/schema/rate-cards";
import { runInTenantContext } from "./tenant-context";

export type RateCard = typeof rateCards.$inferSelect;

export interface CreateRateCardInput {
  creatorId: string;
  name: string;
  validFrom?: Date | null;
  validTo?: Date | null;
}

export const RateCardsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardInput,
  ): Promise<RateCard> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [rateCard] = await tx
        .insert(rateCards)
        .values({
          organizationId,
          creatorId: input.creatorId,
          name: input.name,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
        })
        .returning();
      return rateCard;
    });
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
  ): Promise<RateCard | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [rateCard] = await tx
        .select()
        .from(rateCards)
        .where(and(eq(rateCards.id, rateCardId), eq(rateCards.organizationId, organizationId)));
      return rateCard ?? null;
    });
  },

  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<RateCard[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(rateCards)
        .where(and(eq(rateCards.organizationId, organizationId), eq(rateCards.creatorId, creatorId)));
    });
  },

  async setLocked(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
    locked: boolean,
  ): Promise<RateCard> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [rateCard] = await tx
        .update(rateCards)
        .set({ isLocked: locked })
        .where(and(eq(rateCards.id, rateCardId), eq(rateCards.organizationId, organizationId)))
        .returning();
      return rateCard;
    });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/rate-cards.repository.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/repositories
git commit -m "feat: add RateCardsRepository"
```

---

### Task 8: `RateCardItemsRepository`

**Files:**
- Create: `src/repositories/rate-card-items.repository.ts`
- Test: `src/repositories/rate-card-items.repository.test.ts`

**Interfaces:**
- Produces: `RateCardItem` type and `RateCardItemsRepository.create(db, organizationId, input: { rateCardId: string; serviceId: string; price: number; unitDescription?: string | null; sortOrder?: number }): Promise<RateCardItem>`, `RateCardItemsRepository.update(db, organizationId, itemId: string, input: { price?: number; unitDescription?: string | null; sortOrder?: number }): Promise<RateCardItem>`, `RateCardItemsRepository.remove(db, organizationId, itemId: string): Promise<void>`, `RateCardItemsRepository.listByRateCard(db, organizationId, rateCardId: string): Promise<RateCardItem[]>` from
  `src/repositories/rate-card-items.repository.ts`. This repository does **not** itself
  enforce the `is_locked` rule — that check belongs to `RateCardItemService` (Task 10),
  which reads the parent Rate Card first. This repository is a plain, unguarded data-access
  layer, consistent with how every other repository in this codebase stays free of business
  rules (rules live in `services/`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/repositories/rate-card-items.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { services } from "@/db/schema/services";
import { rateCards, rateCardItems } from "@/db/schema/rate-cards";
import { RateCardItemsRepository } from "./rate-card-items.repository";

describe("RateCardItemsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates, updates, lists, and removes rate card items", async () => {
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

    const created = await RateCardItemsRepository.create(db, org.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
      sortOrder: 1,
    });

    expect(created.price).toBe(200000);
    expect(created.sortOrder).toBe(1);

    const updated = await RateCardItemsRepository.update(db, org.id, created.id, {
      price: 250000,
    });
    expect(updated.price).toBe(250000);

    const list = await RateCardItemsRepository.listByRateCard(db, org.id, rateCard.id);
    expect(list).toHaveLength(1);

    await RateCardItemsRepository.remove(db, org.id, created.id);

    const listAfterRemove = await RateCardItemsRepository.listByRateCard(db, org.id, rateCard.id);
    expect(listAfterRemove).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/rate-card-items.repository.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the repository**

```typescript
// src/repositories/rate-card-items.repository.ts
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { rateCardItems } from "@/db/schema/rate-cards";
import { runInTenantContext } from "./tenant-context";

export type RateCardItem = typeof rateCardItems.$inferSelect;

export interface CreateRateCardItemInput {
  rateCardId: string;
  serviceId: string;
  price: number;
  unitDescription?: string | null;
  sortOrder?: number;
}

export interface UpdateRateCardItemInput {
  price?: number;
  unitDescription?: string | null;
  sortOrder?: number;
}

export const RateCardItemsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardItemInput,
  ): Promise<RateCardItem> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [item] = await tx
        .insert(rateCardItems)
        .values({
          organizationId,
          rateCardId: input.rateCardId,
          serviceId: input.serviceId,
          price: input.price,
          unitDescription: input.unitDescription ?? null,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning();
      return item;
    });
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    input: UpdateRateCardItemInput,
  ): Promise<RateCardItem> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [item] = await tx
        .update(rateCardItems)
        .set(input)
        .where(and(eq(rateCardItems.id, itemId), eq(rateCardItems.organizationId, organizationId)))
        .returning();
      return item;
    });
  },

  async remove(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, async (tx) => {
      await tx
        .delete(rateCardItems)
        .where(and(eq(rateCardItems.id, itemId), eq(rateCardItems.organizationId, organizationId)));
    });
  },

  async listByRateCard(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
  ): Promise<RateCardItem[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(rateCardItems)
        .where(
          and(eq(rateCardItems.organizationId, organizationId), eq(rateCardItems.rateCardId, rateCardId)),
        );
    });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/rate-card-items.repository.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repositories
git commit -m "feat: add RateCardItemsRepository"
```

---

### Task 9: `RateCardService` (create, list, lock, duplicate)

**Files:**
- Create: `src/services/rate-card.service.ts`
- Test: `src/services/rate-card.service.test.ts`

**Interfaces:**
- Consumes: `RateCardsRepository` (Task 7), `RateCardItemsRepository` (Task 8).
- Produces: `RateCardService.create(db, organizationId, input: { creatorId: string; name: string; validFrom?: Date | null; validTo?: Date | null }): Promise<RateCard>`, `RateCardService.listByCreator(db, organizationId, creatorId: string): Promise<RateCard[]>`, `RateCardService.lock(db, organizationId, rateCardId: string): Promise<RateCard>`, `RateCardService.duplicate(db, organizationId, rateCardId: string, input: { name: string }): Promise<{ rateCard: RateCard; items: RateCardItem[] }>` from
  `src/services/rate-card.service.ts`. `duplicate` works regardless of the source Rate
  Card's `isLocked` state (duplicating a locked table to create a new, editable version is
  the intended recovery path per spec Decisão #1) — the new Rate Card it creates always
  starts with `isLocked: false`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/rate-card.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ServiceService } from "./service.service";
import { RateCardService } from "./rate-card.service";
import { RateCardsRepository } from "@/repositories/rate-cards.repository";
import { RateCardItemsRepository } from "@/repositories/rate-card-items.repository";

describe("RateCardService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Thais",
      displayName: "Thais",
    });
    return { organization, creator };
  }

  it("creates and lists rate cards for a creator", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setup(db);

    await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });

    const list = await RateCardService.listByCreator(db, organization.id, creator.id);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Tabela 2026");
  });

  it("locks a rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setup(db);

    const rateCard = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });

    const locked = await RateCardService.lock(db, organization.id, rateCard.id);
    expect(locked.isLocked).toBe(true);
  });

  it("duplicates a locked rate card into a new, unlocked one with the same items", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setup(db);

    const service = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "01 Reel",
    });

    const original = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });

    await RateCardItemsRepository.create(db, organization.id, {
      rateCardId: original.id,
      serviceId: service.id,
      price: 200000,
      sortOrder: 1,
    });

    await RateCardsRepository.setLocked(db, organization.id, original.id, true);

    const { rateCard: duplicated, items } = await RateCardService.duplicate(
      db,
      organization.id,
      original.id,
      { name: "Tabela 2027" },
    );

    expect(duplicated.id).not.toBe(original.id);
    expect(duplicated.name).toBe("Tabela 2027");
    expect(duplicated.isLocked).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0].rateCardId).toBe(duplicated.id);
    expect(items[0].price).toBe(200000);

    const originalItems = await RateCardItemsRepository.listByRateCard(
      db,
      organization.id,
      original.id,
    );
    expect(originalItems).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/rate-card.service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the service**

```typescript
// src/services/rate-card.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  RateCardsRepository,
  type RateCard,
  type CreateRateCardInput,
} from "@/repositories/rate-cards.repository";
import {
  RateCardItemsRepository,
  type RateCardItem,
} from "@/repositories/rate-card-items.repository";

export interface DuplicateRateCardInput {
  name: string;
}

export interface DuplicateRateCardResult {
  rateCard: RateCard;
  items: RateCardItem[];
}

export const RateCardService = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardInput,
  ): Promise<RateCard> {
    return RateCardsRepository.create(db, organizationId, input);
  },

  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<RateCard[]> {
    return RateCardsRepository.listByCreator(db, organizationId, creatorId);
  },

  async lock(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
  ): Promise<RateCard> {
    return RateCardsRepository.setLocked(db, organizationId, rateCardId, true);
  },

  async duplicate(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
    input: DuplicateRateCardInput,
  ): Promise<DuplicateRateCardResult> {
    const original = await RateCardsRepository.findById(db, organizationId, rateCardId);
    if (!original) {
      throw new Error(`Rate card ${rateCardId} not found`);
    }

    const originalItems = await RateCardItemsRepository.listByRateCard(
      db,
      organizationId,
      rateCardId,
    );

    const rateCard = await RateCardsRepository.create(db, organizationId, {
      creatorId: original.creatorId,
      name: input.name,
      validFrom: original.validFrom,
      validTo: original.validTo,
    });

    const items: RateCardItem[] = [];
    for (const originalItem of originalItems) {
      const item = await RateCardItemsRepository.create(db, organizationId, {
        rateCardId: rateCard.id,
        serviceId: originalItem.serviceId,
        price: originalItem.price,
        unitDescription: originalItem.unitDescription,
        sortOrder: originalItem.sortOrder,
      });
      items.push(item);
    }

    return { rateCard, items };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/rate-card.service.test.ts`
Expected: PASS (all three tests)

- [ ] **Step 5: Commit**

```bash
git add src/services
git commit -m "feat: add RateCardService (create, list, lock, duplicate)"
```

---

### Task 10: `RateCardItemService` (enforces the lock rule)

**Files:**
- Create: `src/services/rate-card-item.service.ts`
- Test: `src/services/rate-card-item.service.test.ts`

**Interfaces:**
- Consumes: `RateCardsRepository.findById` (Task 7), `RateCardItemsRepository` (Task 8),
  `RateCardLockedError` (Task 4).
- Produces: `RateCardItemService.addItem(db, organizationId, input: { rateCardId: string; serviceId: string; price: number; unitDescription?: string | null; sortOrder?: number }): Promise<RateCardItem>`, `RateCardItemService.updateItem(db, organizationId, itemId: string, rateCardId: string, input: UpdateRateCardItemInput): Promise<RateCardItem>`, `RateCardItemService.removeItem(db, organizationId, itemId: string, rateCardId: string): Promise<void>` from
  `src/services/rate-card-item.service.ts`. All three throw `RateCardLockedError` when
  `rateCardId`'s `isLocked` is `true`, checked BEFORE the write. `updateItem`/`removeItem`
  take `rateCardId` explicitly (rather than looking it up from the item) so the lock check
  never needs a second query to find which Rate Card an item belongs to — the API route
  layer (Task 13) always has both ids from the URL path.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/rate-card-item.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ServiceService } from "./service.service";
import { RateCardService } from "./rate-card.service";
import { RateCardItemService } from "./rate-card-item.service";
import { RateCardLockedError } from "@/domain/rate-cards/errors";

describe("RateCardItemService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Thais",
      displayName: "Thais",
    });
    const service = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "01 Reel",
    });
    const rateCard = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });
    return { organization, creator, service, rateCard };
  }

  it("adds, updates, and removes an item on an unlocked rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, service, rateCard } = await setup(db);

    const item = await RateCardItemService.addItem(db, organization.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    const updated = await RateCardItemService.updateItem(
      db,
      organization.id,
      item.id,
      rateCard.id,
      { price: 250000 },
    );
    expect(updated.price).toBe(250000);

    await RateCardItemService.removeItem(db, organization.id, item.id, rateCard.id);
  });

  it("rejects adding an item to a locked rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, service, rateCard } = await setup(db);

    await RateCardService.lock(db, organization.id, rateCard.id);

    await expect(
      RateCardItemService.addItem(db, organization.id, {
        rateCardId: rateCard.id,
        serviceId: service.id,
        price: 200000,
      }),
    ).rejects.toThrow(RateCardLockedError);
  });

  it("rejects updating an item on a locked rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, service, rateCard } = await setup(db);

    const item = await RateCardItemService.addItem(db, organization.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    await RateCardService.lock(db, organization.id, rateCard.id);

    await expect(
      RateCardItemService.updateItem(db, organization.id, item.id, rateCard.id, {
        price: 300000,
      }),
    ).rejects.toThrow(RateCardLockedError);
  });

  it("rejects removing an item from a locked rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, service, rateCard } = await setup(db);

    const item = await RateCardItemService.addItem(db, organization.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    await RateCardService.lock(db, organization.id, rateCard.id);

    await expect(
      RateCardItemService.removeItem(db, organization.id, item.id, rateCard.id),
    ).rejects.toThrow(RateCardLockedError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/rate-card-item.service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the service**

```typescript
// src/services/rate-card-item.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { RateCardsRepository } from "@/repositories/rate-cards.repository";
import {
  RateCardItemsRepository,
  type RateCardItem,
  type CreateRateCardItemInput,
  type UpdateRateCardItemInput,
} from "@/repositories/rate-card-items.repository";
import { RateCardLockedError } from "@/domain/rate-cards/errors";

async function assertNotLocked(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  rateCardId: string,
): Promise<void> {
  const rateCard = await RateCardsRepository.findById(db, organizationId, rateCardId);
  if (rateCard?.isLocked) {
    throw new RateCardLockedError(rateCardId);
  }
}

export const RateCardItemService = {
  async addItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardItemInput,
  ): Promise<RateCardItem> {
    await assertNotLocked(db, organizationId, input.rateCardId);
    return RateCardItemsRepository.create(db, organizationId, input);
  },

  async updateItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    rateCardId: string,
    input: UpdateRateCardItemInput,
  ): Promise<RateCardItem> {
    await assertNotLocked(db, organizationId, rateCardId);
    return RateCardItemsRepository.update(db, organizationId, itemId, input);
  },

  async removeItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    rateCardId: string,
  ): Promise<void> {
    await assertNotLocked(db, organizationId, rateCardId);
    return RateCardItemsRepository.remove(db, organizationId, itemId);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/rate-card-item.service.test.ts`
Expected: PASS (all four tests)

- [ ] **Step 5: Commit**

```bash
git add src/services
git commit -m "feat: add RateCardItemService enforcing the lock rule"
```

---

### Task 11: API routes — Services

**Files:**
- Create: `src/app/api/services/route.ts`
- Create: `src/app/api/services/[id]/route.ts`
- Test: `src/app/api/services/route.test.ts`

**Interfaces:**
- Produces: `POST /api/services` accepting `{ organizationId: string; creatorId: string; name: string; description?: string | null; unitDescription?: string | null }`, returning `201` with the created `Service`. `GET /api/services?organizationId=&creatorId=`, returning `200` with `Service[]`. `PATCH /api/services/:id` accepting `{ organizationId: string; name?: string; description?: string | null; unitDescription?: string | null; isActive?: boolean }`, returning `200` with the updated `Service`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/services/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

describe("POST /api/services", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the created service", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const { POST } = await import("./route");

    const request = new Request("http://localhost/api/services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        creatorId: creator.id,
        name: "01 Reel",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.name).toBe("01 Reel");
    expect(json.isActive).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/services/route.test.ts`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 3: Implement the routes**

```typescript
// src/app/api/services/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ServiceService } from "@/services/service.service";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  unitDescription: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const payload = createSchema.parse(await request.json());
  const service = await ServiceService.create(db, payload.organizationId, {
    creatorId: payload.creatorId,
    name: payload.name,
    description: payload.description,
    unitDescription: payload.unitDescription,
  });
  return NextResponse.json(service, { status: 201 });
}

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
  const list = await ServiceService.listByCreator(db, payload.organizationId, payload.creatorId);
  return NextResponse.json(list, { status: 200 });
}
```

```typescript
// src/app/api/services/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ServiceService } from "@/services/service.service";

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  unitDescription: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = updateSchema.parse(await request.json());
  const { organizationId, ...input } = payload;
  const service = await ServiceService.update(db, organizationId, id, input);
  return NextResponse.json(service, { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/services/route.test.ts`
Expected: PASS

- [ ] **Step 5: Verify the app still builds**

Run: `pnpm build`
Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/services
git commit -m "feat: expose Services as API routes"
```

---

### Task 12: API routes — Rate Cards (create, list, duplicate)

**Files:**
- Create: `src/app/api/rate-cards/route.ts`
- Create: `src/app/api/rate-cards/[id]/duplicate/route.ts`
- Test: `src/app/api/rate-cards/route.test.ts`

**Interfaces:**
- Produces: `POST /api/rate-cards` accepting `{ organizationId: string; creatorId: string; name: string; validFrom?: string | null; validTo?: string | null }` (ISO date strings, converted to `Date`), returning `201`. `GET /api/rate-cards?organizationId=&creatorId=`, returning `200` with `RateCard[]`. `POST /api/rate-cards/:id/duplicate` accepting `{ organizationId: string; name: string }`, returning `201` with `{ rateCard: RateCard; items: RateCardItem[] }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/rate-cards/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

describe("POST /api/rate-cards", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the created rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const { POST } = await import("./route");

    const request = new Request("http://localhost/api/rate-cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        creatorId: creator.id,
        name: "Tabela 2026",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.name).toBe("Tabela 2026");
    expect(json.isLocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/rate-cards/route.test.ts`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 3: Implement the routes**

```typescript
// src/app/api/rate-cards/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardService } from "@/services/rate-card.service";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
  name: z.string().min(1),
  validFrom: z.string().datetime().nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request) {
  const payload = createSchema.parse(await request.json());
  const rateCard = await RateCardService.create(db, payload.organizationId, {
    creatorId: payload.creatorId,
    name: payload.name,
    validFrom: payload.validFrom ? new Date(payload.validFrom) : null,
    validTo: payload.validTo ? new Date(payload.validTo) : null,
  });
  return NextResponse.json(rateCard, { status: 201 });
}

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
  const list = await RateCardService.listByCreator(db, payload.organizationId, payload.creatorId);
  return NextResponse.json(list, { status: 200 });
}
```

```typescript
// src/app/api/rate-cards/[id]/duplicate/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardService } from "@/services/rate-card.service";

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());
  const result = await RateCardService.duplicate(db, payload.organizationId, id, {
    name: payload.name,
  });
  return NextResponse.json(result, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/rate-cards/route.test.ts`
Expected: PASS

- [ ] **Step 5: Verify the app still builds**

Run: `pnpm build`
Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/rate-cards
git commit -m "feat: expose Rate Cards create/list/duplicate as API routes"
```

---

### Task 13: API routes — Rate Card Items

**Files:**
- Create: `src/app/api/rate-cards/[id]/items/route.ts`
- Create: `src/app/api/rate-card-items/[id]/route.ts`
- Test: `src/app/api/rate-cards/[id]/items/route.test.ts`

**Interfaces:**
- Produces: `POST /api/rate-cards/:id/items` accepting `{ organizationId: string; serviceId: string; price: number; unitDescription?: string | null; sortOrder?: number }`, returning `201` with the created `RateCardItem`, or `409` if the rate card is locked. `PATCH /api/rate-card-items/:id` accepting `{ organizationId: string; rateCardId: string; price?: number; unitDescription?: string | null; sortOrder?: number }`, returning `200`, or `409` if locked. `DELETE /api/rate-card-items/:id` accepting `{ organizationId: string; rateCardId: string }` in the body, returning `204`, or `409` if locked.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/api/rate-cards/[id]/items/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ServiceService } from "@/services/service.service";
import { RateCardService } from "@/services/rate-card.service";

describe("POST /api/rate-cards/:id/items", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the created item on an unlocked rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });
    const service = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "01 Reel",
    });
    const rateCard = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });

    const { POST } = await import("./route");

    const request = new Request(`http://localhost/api/rate-cards/${rateCard.id}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        serviceId: service.id,
        price: 200000,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: rateCard.id }) });
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.price).toBe(200000);
  });

  it("returns 409 when the rate card is locked", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner2@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais2@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });
    const service = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "01 Reel",
    });
    const rateCard = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });
    await RateCardService.lock(db, organization.id, rateCard.id);

    const { POST } = await import("./route");

    const request = new Request(`http://localhost/api/rate-cards/${rateCard.id}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        serviceId: service.id,
        price: 200000,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: rateCard.id }) });
    expect(response.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run "src/app/api/rate-cards/[id]/items/route.test.ts"`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 3: Implement the routes**

```typescript
// src/app/api/rate-cards/[id]/items/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardItemService } from "@/services/rate-card-item.service";
import { RateCardLockedError } from "@/domain/rate-cards/errors";

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  serviceId: z.string().uuid(),
  price: z.number().int().nonnegative(),
  unitDescription: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());

  try {
    const item = await RateCardItemService.addItem(db, payload.organizationId, {
      rateCardId: id,
      serviceId: payload.serviceId,
      price: payload.price,
      unitDescription: payload.unitDescription,
      sortOrder: payload.sortOrder,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof RateCardLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
```

```typescript
// src/app/api/rate-card-items/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { RateCardItemService } from "@/services/rate-card-item.service";
import { RateCardLockedError } from "@/domain/rate-cards/errors";

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  rateCardId: z.string().uuid(),
  price: z.number().int().nonnegative().optional(),
  unitDescription: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = updateSchema.parse(await request.json());
  const { organizationId, rateCardId, ...input } = payload;

  try {
    const item = await RateCardItemService.updateItem(db, organizationId, id, rateCardId, input);
    return NextResponse.json(item, { status: 200 });
  } catch (error) {
    if (error instanceof RateCardLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

const deleteSchema = z.object({
  organizationId: z.string().uuid(),
  rateCardId: z.string().uuid(),
});

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = deleteSchema.parse(await request.json());

  try {
    await RateCardItemService.removeItem(db, payload.organizationId, id, payload.rateCardId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof RateCardLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run "src/app/api/rate-cards/[id]/items/route.test.ts"`
Expected: PASS (both tests)

- [ ] **Step 5: Verify the app still builds**

Run: `pnpm build`
Expected: exit code 0.

- [ ] **Step 6: Run the full suite one last time**

Run: `pnpm test`
Expected: all pass, no regressions across the whole plan.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/rate-cards src/app/api/rate-card-items
git commit -m "feat: expose Rate Card Items as API routes, mapping RateCardLockedError to 409"
```

---

## Self-Review

**Spec coverage:**
- §2 Decisão #1 (immutability via `is_locked`) — Task 4 (error), Task 9/10 (lock method +
  enforcement).
- §2 Decisão #2 (explicit selection, `valid_from`/`valid_to` informational only) — schema
  in Task 2 carries the fields; no task adds auto-selection logic anywhere, consistent with
  the decision.
- §2 Decisão #3/#4 (per-creator scoping) — `creatorId` not-null on both `services` and
  `rate_cards` schemas (Tasks 1, 2).
- §2 Decisão #6/#7 (`valid_from`/`valid_to`, `sort_order`) — Task 2 (`rate_cards.validFrom`/
  `validTo`), Task 2/3 (`rate_card_items.sortOrder`).
- §2 Decisão #8 (`is_default` and DRAFT/PUBLISHED/LOCKED deferred) — correctly absent from
  every task; no task in this plan implements either.
- §3 Modelo de Dados — every column in the spec's three tables is covered across Tasks 1-3,
  including the `restrict` FK from `rate_card_items.service_id` to `services` (tested in
  Task 3).
- §3 "Regra não-negociável" (RLS from the first migration) — every schema task (1, 2, 3)
  enables RLS and adds an isolation test in the same task, never deferred.
- §4 Camadas — Tasks 5-10 follow `repositories` → `services` exactly, with the lock check
  isolated to `RateCardItemService`, never duplicated into the repository layer.
- §4 "sem hard-delete de Service" — `ServicesRepository`/`ServiceService` (Tasks 5-6)
  expose no `delete` method anywhere; only `isActive` toggling.
- §5 API Routes — Tasks 11-13 cover every route listed in the spec.
- §6 Pendências — auth/session (organizationId in body) and HTTP error mapping are
  consistent with the prior plan's documented gaps; this plan's Task 13 does add 409
  mapping for `RateCardLockedError` specifically (a new, local improvement over the blanket
  500 gap noted in the prior plan's ledger — worth flagging to whoever eventually builds
  the shared error-mapping layer, since it's a good pattern to generalize).

**Placeholder scan:** no TBD/TODO, no "add error handling"-style steps — every step has
concrete code.

**Type consistency:** `RateCard`, `RateCardItem`, `Service` types are each defined once (via
`$inferSelect`) and reused by name across all later tasks without redefinition drift.
`RateCardItemService.updateItem`/`removeItem` consistently take `(db, organizationId,
itemId, rateCardId, ...)` in that argument order across Task 10's implementation and Task
13's route call sites.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-21-services-and-rate-cards.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
