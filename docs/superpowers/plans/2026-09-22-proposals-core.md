# Proposals (Core Domain) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the structural core of Proposals — proposals, items (catalog-sourced or
ad-hoc), content blocks, and automatic version snapshots — per
`docs/superpowers/specs/2026-09-22-proposals-core-design.md`.

**Architecture:** Same layering as every prior plan: `db/schema` → `repositories` (via
`runInTenantContext`, with `*WithTx` siblings from the start) → `services` (domain rules) →
`app/api`. Every multi-write operation is atomic from the first commit, and every
caller-suppliable foreign id is validated by organization (and creator, where relevant)
in the service layer — both lessons the final reviews of the two prior plans had to fix
after the fact are applied here by design.

**Tech Stack:** Next.js 16 (Route Handlers), Drizzle ORM, PostgreSQL (RLS), Zod, Vitest.

## Global Constraints

- Every new table carries `organization_id` with RLS enabled in the SAME migration that
  creates the table — no exceptions, no follow-up task.
- `proposal_items.rate_card_item_id` is nullable — ad-hoc items (no catalog link) are
  first-class, not a special case.
- The Rate Card behind a `proposal_item.rate_card_item_id` locks (`RateCardService`'s
  underlying repository call) on first effective use, whether that happens at proposal
  creation or a later edit — never tied to the moment the Proposal itself was created.
  Ad-hoc items never trigger a lock.
- When `rate_card_item_id` is supplied, its Rate Card's `creator_id` MUST equal the
  Proposal's Opportunity's `creator_id` — validated explicitly in the service layer, not
  left to RLS (Postgres FK checks bypass RLS).
- Any `userId` supplied to a mutating endpoint MUST resolve to an `organization_members`
  row for the request's `organizationId` — validated explicitly, not just FK-valid against
  `users`.
- A version snapshot is written only when the proposal's content actually changed (compare
  before deciding to snapshot) — creates and deletes always count as a change; updates only
  count if some persisted field's value actually differs.
- Only `DRAFT`/`ARCHIVED` statuses exist in this plan. No `SENT`/`APPROVED`/`REJECTED`, no
  PDF, no AI generation, no public sharing/view events — all explicitly out of scope.
- `proposal_versions` has `UNIQUE (proposal_id, version_number)`.

---

## File Structure

```
src/
  db/
    schema/
      proposals.ts                      # proposals, proposal_items, proposal_blocks, proposal_versions
      index.ts                          # modify: barrel re-export
    migrations/
      0010_add_locked_at_to_rate_cards.sql
      0011_add_proposals.sql
      0012_add_proposal_items.sql
      0013_add_proposal_blocks.sql
      0014_add_proposal_versions.sql
  domain/
    proposals/
      errors.ts                         # ProposalNotFoundError, OpportunityNotFoundError,
                                         # UserNotOrganizationMemberError,
                                         # RateCardItemCreatorMismatchError
  repositories/
    organization-members.repository.ts  # NEW: membership existence check
    opportunities.repository.ts         # MODIFY: add findById/findByIdWithTx
    rate-card-items.repository.ts       # MODIFY: add findById/findByIdWithTx
    rate-cards.repository.ts            # MODIFY: add setLockedWithTx
    proposals.repository.ts
    proposal-items.repository.ts
    proposal-blocks.repository.ts
    proposal-versions.repository.ts     # includes snapshot-building + next-version-number logic
  services/
    rate-card.service.ts                # MODIFY: lockedAt population (via repository change)
    proposal.service.ts
    proposal-item.service.ts
    proposal-block.service.ts
  app/
    api/
      proposals/
        route.ts                        # POST, GET
        [id]/
          route.ts                      # PATCH
          items/route.ts                # POST
          blocks/route.ts                # POST
          versions/route.ts              # GET
      proposal-items/
        [id]/route.ts                   # PATCH, DELETE
      proposal-blocks/
        [id]/route.ts                   # PATCH, DELETE
```

---

### Task 1: `rate_cards.locked_at` + `setLockedWithTx`

**Files:**
- Modify: `src/db/schema/rate-cards.ts` (add `lockedAt` column)
- Create: `src/db/migrations/0010_add_locked_at_to_rate_cards.sql`
- Modify: `src/repositories/rate-cards.repository.ts` (populate `lockedAt`, add `setLockedWithTx`)
- Test: extend `src/repositories/rate-cards.repository.test.ts`

**Interfaces:**
- Produces: `RateCardsRepository.setLockedWithTx(tx, organizationId, rateCardId, locked): Promise<RateCard>` — used by `ProposalItemService` (Task 13) to lock a Rate Card inside the same transaction as creating a `proposal_item`.
- `RateCard.lockedAt: Date | null` — set to `now()` whenever `isLocked` transitions to `true`; left untouched (not cleared) if `setLocked` is ever called with `locked: false` in the future (no unlock flow exists yet — out of scope to design here, just don't lose the timestamp).

- [ ] **Step 1: Write the failing test**

```typescript
// append to src/repositories/rate-cards.repository.test.ts
import { RateCardsRepository } from "./rate-cards.repository";
// (existing imports already present — add this test inside the existing describe block or a new one)

it("sets lockedAt when locking, both via setLocked and setLockedWithTx", async () => {
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

  const cardA = await RateCardsRepository.create(db, org.id, { creatorId: creator.id, name: "A" });
  const lockedA = await RateCardsRepository.setLocked(db, org.id, cardA.id, true);
  expect(lockedA.lockedAt).not.toBeNull();

  const cardB = await RateCardsRepository.create(db, org.id, { creatorId: creator.id, name: "B" });
  const lockedB = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org_id', ${org.id}, true)`);
    return RateCardsRepository.setLockedWithTx(tx, org.id, cardB.id, true);
  });
  expect(lockedB.lockedAt).not.toBeNull();
});
```

(Add `import { sql } from "drizzle-orm";` to the test file's imports if not already present.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/rate-cards.repository.test.ts`
Expected: FAIL — `lockedAt` column doesn't exist, `setLockedWithTx` doesn't exist.

- [ ] **Step 3: Add the column**

```typescript
// src/db/schema/rate-cards.ts — add to the rateCards table definition, after isLocked:
  lockedAt: timestamp("locked_at", { withTimezone: true }),
```

- [ ] **Step 4: Generate and apply the migration**

```bash
pnpm drizzle-kit generate --name add_locked_at_to_rate_cards
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

- [ ] **Step 5: Update the repository**

```typescript
// src/repositories/rate-cards.repository.ts
// Replace the body of `setLocked` and add `setLockedWithTx`, sharing logic
// via a new private helper, matching the established pattern:

async function updateLocked(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  rateCardId: string,
  locked: boolean,
): Promise<RateCard> {
  const [rateCard] = await tx
    .update(rateCards)
    .set({ isLocked: locked, ...(locked ? { lockedAt: new Date() } : {}) })
    .where(and(eq(rateCards.id, rateCardId), eq(rateCards.organizationId, organizationId)))
    .returning();
  if (!rateCard) {
    throw new RateCardNotFoundError(rateCardId);
  }
  return rateCard;
}
```

Replace the existing `setLocked` method body with `return runInTenantContext(db, organizationId, (tx) => updateLocked(tx, organizationId, rateCardId, locked));` and add:

```typescript
  async setLockedWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
    locked: boolean,
  ): Promise<RateCard> {
    return updateLocked(tx, organizationId, rateCardId, locked);
  },
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/rate-cards.repository.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite, then commit**

Run: `pnpm test`
Expected: all pass.

```bash
git add src/db src/repositories
git commit -m "feat: add rate_cards.locked_at and RateCardsRepository.setLockedWithTx"
```

---

### Task 2: Schema — `proposals`

**Files:**
- Create: `src/db/schema/proposals.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/test/helpers/db.ts` (prepend `"proposals"` to `DOMAIN_TABLES`)
- Test: `src/db/schema/proposals.test.ts`
- Test: `src/db/rls-proposals.test.ts`

**Interfaces:**
- Produces: `proposalTemplateEnum` (`PREMIUM|MINIMAL|EDITORIAL|FASHION|BEAUTY|CORPORATE`), `proposalStatusEnum` (`DRAFT|ARCHIVED`), `proposals` table — `id`, `organizationId`, `opportunityId` (not null, FK → opportunities, restrict), `title`, `template`, `status` (default `DRAFT`), `createdAt`. This file will also hold `proposalItems`/`proposalBlocks`/`proposalVersions` by the end of Task 5 — only `proposals` is defined in this task.

- [ ] **Step 1: Write the failing schema test**

```typescript
// src/db/schema/proposals.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { leads, opportunities } from "./commercial-flow";
import { proposals } from "./proposals";

describe("proposals schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("stores a proposal linked to an opportunity, defaulting status DRAFT", async () => {
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
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        leadId: lead.id,
        companyId: null,
        brandId: null,
      })
      .returning();

    const [proposal] = await db
      .insert(proposals)
      .values({
        organizationId: org.id,
        opportunityId: opportunity.id,
        title: "Campanha Verão",
        template: "PREMIUM",
      })
      .returning();

    expect(proposal.status).toBe("DRAFT");
    expect(proposal.opportunityId).toBe(opportunity.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/proposals.test.ts`
Expected: FAIL — `./proposals` doesn't exist.

- [ ] **Step 3: Implement the schema**

```typescript
// src/db/schema/proposals.ts
import { pgEnum, pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { opportunities } from "./commercial-flow";

export const proposalTemplateEnum = pgEnum("proposal_template", [
  "PREMIUM",
  "MINIMAL",
  "EDITORIAL",
  "FASHION",
  "BEAUTY",
  "CORPORATE",
]);

export const proposalStatusEnum = pgEnum("proposal_status", ["DRAFT", "ARCHIVED"]);

export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  template: proposalTemplateEnum("template").notNull(),
  status: proposalStatusEnum("status").notNull().default("DRAFT"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Register in the barrel, generate migration, hand-append RLS**

```typescript
// src/db/schema/index.ts — add:
export * from "./proposals";
```

```bash
pnpm drizzle-kit generate --name add_proposals
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

Append to the end of the generated `src/db/migrations/0011_add_proposals.sql`:

```sql

-- Hand-appended (not drizzle-generated): RLS enabled in the same migration
-- that creates the table. Same convention as every prior RLS migration.
alter table proposals enable row level security;

create policy org_isolation_proposals on proposals
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
```

Re-apply: `DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate`

- [ ] **Step 5: Extend `DOMAIN_TABLES`**

```typescript
// src/test/helpers/db.ts — prepend "proposals" to DOMAIN_TABLES
```

- [ ] **Step 6: Run schema test, write + run RLS test**

Run: `pnpm vitest run src/db/schema/proposals.test.ts` — Expected: PASS

```typescript
// src/db/rls-proposals.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { organizations, users } from "./schema/organizations";
import { creators } from "./schema/creators";
import { contacts } from "./schema/companies-brands-contacts";
import { leads, opportunities } from "./schema/commercial-flow";
import { proposals } from "./schema/proposals";

describe("RLS on proposals", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns proposals belonging to the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    async function seedOpportunity(orgName: string) {
      const [org] = await db.insert(organizations).values({ name: orgName }).returning();
      const [user] = await db
        .insert(users)
        .values({ email: `${orgName}@publyflow.test`, fullName: orgName })
        .returning();
      const [creator] = await db
        .insert(creators)
        .values({ organizationId: org.id, userId: user.id, displayName: orgName })
        .returning();
      const [contact] = await db
        .insert(contacts)
        .values({ organizationId: org.id, fullName: "Contact" })
        .returning();
      const [lead] = await db
        .insert(leads)
        .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
        .returning();
      const [opportunity] = await db
        .insert(opportunities)
        .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
        .returning();
      return { org, opportunity };
    }

    const a = await seedOpportunity("Org A");
    const b = await seedOpportunity("Org B");

    await db.insert(proposals).values({
      organizationId: a.org.id,
      opportunityId: a.opportunity.id,
      title: "Proposal A",
      template: "PREMIUM",
    });
    await db.insert(proposals).values({
      organizationId: b.org.id,
      opportunityId: b.opportunity.id,
      title: "Proposal B",
      template: "PREMIUM",
    });

    const appDb = getAppUserDb();
    const visible = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${a.org.id}, true)`);
      return tx.select().from(proposals);
    });

    expect(visible).toHaveLength(1);
    expect(visible[0].title).toBe("Proposal A");
  });
});
```

Run: `pnpm vitest run src/db/rls-proposals.test.ts` — Expected: PASS

- [ ] **Step 7: Run the full suite, then commit**

```bash
pnpm test
git add src/db src/test
git commit -m "feat: add proposals schema with RLS from creation"
```

---

### Task 3: Schema — `proposal_items`

**Files:**
- Modify: `src/db/schema/proposals.ts` (add `proposalItems` table)
- Modify: `src/test/helpers/db.ts`
- Test: `src/db/schema/proposal-items.test.ts`
- Test: `src/db/rls-proposal-items.test.ts`

**Interfaces:**
- Produces: `proposalItems` table — `id`, `organizationId`, `proposalId` (FK → proposals, cascade), `rateCardItemId` (nullable, FK → rate_card_items, restrict), `description`, `quantity` (default 1), `unitPrice` (integer, cents), `sortOrder` (default 0), `createdAt`.

- [ ] **Step 1: Write the failing schema test**

```typescript
// src/db/schema/proposal-items.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { leads, opportunities } from "./commercial-flow";
import { proposals, proposalItems } from "./proposals";

describe("proposal_items schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const [proposal] = await db
      .insert(proposals)
      .values({ organizationId: org.id, opportunityId: opportunity.id, title: "P", template: "PREMIUM" })
      .returning();
    return { org, proposal };
  }

  it("stores an ad-hoc item with no rateCardItemId", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal } = await setup(db);

    const [item] = await db
      .insert(proposalItems)
      .values({
        organizationId: org.id,
        proposalId: proposal.id,
        rateCardItemId: null,
        description: "Desconto negociado",
        unitPrice: -50000,
      })
      .returning();

    expect(item.rateCardItemId).toBeNull();
    expect(item.quantity).toBe(1);
    expect(item.sortOrder).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/proposal-items.test.ts`
Expected: FAIL — `proposalItems` doesn't exist.

- [ ] **Step 3: Add the table**

```typescript
// src/db/schema/proposals.ts — add below `proposals`, and add this import at the top:
// import { rateCardItems } from "./rate-cards";
import { integer } from "drizzle-orm/pg-core"; // add to the existing import line

export const proposalItems = pgTable("proposal_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  rateCardItemId: uuid("rate_card_item_id").references(() => rateCardItems.id, { onDelete: "restrict" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: integer("unit_price").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Add `import { rateCardItems } from "./rate-cards";` to the top of `proposals.ts`.

- [ ] **Step 4: Generate migration, hand-append RLS, extend `DOMAIN_TABLES`**

```bash
pnpm drizzle-kit generate --name add_proposal_items
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

Append to `src/db/migrations/0012_add_proposal_items.sql`:

```sql

alter table proposal_items enable row level security;

create policy org_isolation_proposal_items on proposal_items
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
```

Re-apply, then prepend `"proposal_items"` to `DOMAIN_TABLES` in `src/test/helpers/db.ts`.

- [ ] **Step 5: Run schema test, write + run RLS test**

Run: `pnpm vitest run src/db/schema/proposal-items.test.ts` — Expected: PASS

```typescript
// src/db/rls-proposal-items.test.ts
// Same structure as src/db/rls-proposals.test.ts (Task 2): seed two orgs
// each with a proposal, insert one proposal_items row per org (rateCardItemId:
// null, description: "Item", unitPrice: 100000), query via getAppUserDb()
// scoped to org A, assert exactly 1 row with description "Item" belonging
// to org A's proposal. Follow the exact seeding helper pattern from
// src/db/rls-proposals.test.ts's seedOpportunity, extended to also create
// a proposal per org.
```

Write this test following the pattern referenced above, run it, confirm PASS.

- [ ] **Step 6: Run the full suite, then commit**

```bash
pnpm test
git add src/db src/test
git commit -m "feat: add proposal_items schema with RLS from creation"
```

---

### Task 4: Schema — `proposal_blocks`

**Files:**
- Modify: `src/db/schema/proposals.ts` (add `proposalBlockTypeEnum`, `proposalBlocks`)
- Modify: `src/test/helpers/db.ts`
- Test: `src/db/schema/proposal-blocks.test.ts`
- Test: `src/db/rls-proposal-blocks.test.ts`

**Interfaces:**
- Produces: `proposalBlockTypeEnum` (`COVER|TEXT|IMAGE|METRICS|SERVICES|PRICING|TIMELINE|GALLERY|TESTIMONIALS|SOCIAL_LINKS|FOOTER`), `proposalBlocks` table — `id`, `organizationId`, `proposalId` (FK → proposals, cascade), `blockType`, `content` (jsonb), `sortOrder` (default 0), `createdAt`.

- [ ] **Step 1: Write the failing schema test**

```typescript
// src/db/schema/proposal-blocks.test.ts
// Same setup helper as proposal-items.test.ts (Task 3) to get { org, proposal }.
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { leads, opportunities } from "./commercial-flow";
import { proposals, proposalBlocks } from "./proposals";

describe("proposal_blocks schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("stores a block with a jsonb content payload and a block type from the fixed enum", async () => {
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
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const [proposal] = await db
      .insert(proposals)
      .values({ organizationId: org.id, opportunityId: opportunity.id, title: "P", template: "PREMIUM" })
      .returning();

    const [block] = await db
      .insert(proposalBlocks)
      .values({
        organizationId: org.id,
        proposalId: proposal.id,
        blockType: "COVER",
        content: { headline: "Campanha Verão" },
      })
      .returning();

    expect(block.blockType).toBe("COVER");
    expect(block.content).toEqual({ headline: "Campanha Verão" });
    expect(block.sortOrder).toBe(0);
  });

  it("rejects a block type outside the fixed enum", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org2" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais2@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const [proposal] = await db
      .insert(proposals)
      .values({ organizationId: org.id, opportunityId: opportunity.id, title: "P", template: "PREMIUM" })
      .returning();

    await expect(
      db.insert(proposalBlocks).values({
        organizationId: org.id,
        proposalId: proposal.id,
        blockType: "NOT_A_REAL_TYPE" as any,
        content: {},
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/proposal-blocks.test.ts`
Expected: FAIL — `proposalBlocks` doesn't exist.

- [ ] **Step 3: Add the enum and table**

```typescript
// src/db/schema/proposals.ts — add near the other enums:
import { jsonb } from "drizzle-orm/pg-core"; // add to the existing import line

export const proposalBlockTypeEnum = pgEnum("proposal_block_type", [
  "COVER",
  "TEXT",
  "IMAGE",
  "METRICS",
  "SERVICES",
  "PRICING",
  "TIMELINE",
  "GALLERY",
  "TESTIMONIALS",
  "SOCIAL_LINKS",
  "FOOTER",
]);

export const proposalBlocks = pgTable("proposal_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  blockType: proposalBlockTypeEnum("block_type").notNull(),
  content: jsonb("content").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Generate migration, hand-append RLS, extend `DOMAIN_TABLES`**

```bash
pnpm drizzle-kit generate --name add_proposal_blocks
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

Append to `src/db/migrations/0013_add_proposal_blocks.sql`:

```sql

alter table proposal_blocks enable row level security;

create policy org_isolation_proposal_blocks on proposal_blocks
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
```

Re-apply, prepend `"proposal_blocks"` to `DOMAIN_TABLES`.

- [ ] **Step 5: Run schema tests, write + run RLS test**

Run: `pnpm vitest run src/db/schema/proposal-blocks.test.ts` — Expected: PASS (both tests)

Write `src/db/rls-proposal-blocks.test.ts` following the exact same pattern as Task 3's RLS test (two orgs, one block each, `getAppUserDb()` scoped to org A returns only org A's block). Run it, confirm PASS.

- [ ] **Step 6: Run the full suite, then commit**

```bash
pnpm test
git add src/db src/test
git commit -m "feat: add proposal_blocks schema with RLS from creation"
```

---

### Task 5: Schema — `proposal_versions`

**Files:**
- Modify: `src/db/schema/proposals.ts` (add `proposalVersions`)
- Modify: `src/test/helpers/db.ts`
- Test: `src/db/schema/proposal-versions.test.ts`
- Test: `src/db/rls-proposal-versions.test.ts`

**Interfaces:**
- Produces: `proposalVersions` table — `id`, `organizationId`, `proposalId` (FK → proposals, cascade), `versionNumber` (integer), `snapshotJson` (jsonb), `createdBy` (uuid, FK → users, restrict), `createdAt`, with `UNIQUE (proposalId, versionNumber)`.

- [ ] **Step 1: Write the failing schema test**

```typescript
// src/db/schema/proposal-versions.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { leads, opportunities } from "./commercial-flow";
import { proposals, proposalVersions } from "./proposals";

describe("proposal_versions schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const [proposal] = await db
      .insert(proposals)
      .values({ organizationId: org.id, opportunityId: opportunity.id, title: "P", template: "PREMIUM" })
      .returning();
    return { org, user, proposal };
  }

  it("stores a snapshot with a version number and author", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, user, proposal } = await setup(db);

    const [version] = await db
      .insert(proposalVersions)
      .values({
        organizationId: org.id,
        proposalId: proposal.id,
        versionNumber: 1,
        snapshotJson: { proposal: { title: "P" }, items: [], blocks: [] },
        createdBy: user.id,
      })
      .returning();

    expect(version.versionNumber).toBe(1);
    expect(version.createdBy).toBe(user.id);
  });

  it("rejects a duplicate versionNumber for the same proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, user, proposal } = await setup(db);

    await db.insert(proposalVersions).values({
      organizationId: org.id,
      proposalId: proposal.id,
      versionNumber: 1,
      snapshotJson: {},
      createdBy: user.id,
    });

    await expect(
      db.insert(proposalVersions).values({
        organizationId: org.id,
        proposalId: proposal.id,
        versionNumber: 1,
        snapshotJson: {},
        createdBy: user.id,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/proposal-versions.test.ts`
Expected: FAIL — `proposalVersions` doesn't exist.

- [ ] **Step 3: Add the table**

```typescript
// src/db/schema/proposals.ts — add at the end, and add `unique` to the
// existing drizzle-orm/pg-core import line, plus `users` to the imports
// from "./organizations":
// import { users } from "./organizations";  (merge into existing import)

export const proposalVersions = pgTable(
  "proposal_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    snapshotJson: jsonb("snapshot_json").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("proposal_versions_proposal_version_unique").on(table.proposalId, table.versionNumber)],
);
```

- [ ] **Step 4: Generate migration, hand-append RLS, extend `DOMAIN_TABLES`**

```bash
pnpm drizzle-kit generate --name add_proposal_versions
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

Append to `src/db/migrations/0014_add_proposal_versions.sql`:

```sql

alter table proposal_versions enable row level security;

create policy org_isolation_proposal_versions on proposal_versions
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
```

Re-apply, prepend `"proposal_versions"` to `DOMAIN_TABLES`.

- [ ] **Step 5: Run schema tests, write + run RLS test**

Run: `pnpm vitest run src/db/schema/proposal-versions.test.ts` — Expected: PASS (both tests)

Write `src/db/rls-proposal-versions.test.ts` following the Task 3/4 RLS test pattern (two orgs, one version each, scoped read via `getAppUserDb()` returns only the current org's). Run, confirm PASS.

- [ ] **Step 6: Run the full suite, then commit**

```bash
pnpm test
git add src/db src/test
git commit -m "feat: add proposal_versions schema with unique version numbers and RLS"
```

---

### Task 6: Domain errors

**Files:**
- Create: `src/domain/proposals/errors.ts`

**Interfaces:**
- Produces: `ProposalNotFoundError`, `OpportunityNotFoundError`, `UserNotOrganizationMemberError`, `RateCardItemCreatorMismatchError`, `ProposalItemNotFoundError`, `ProposalBlockNotFoundError` from `src/domain/proposals/errors.ts`.

- [ ] **Step 1: Implement the errors**

```typescript
// src/domain/proposals/errors.ts
// Thrown when a proposalId does not resolve to a row visible to the
// caller's organization.
export class ProposalNotFoundError extends Error {
  constructor(proposalId: string) {
    super(`Proposal ${proposalId} not found`);
    this.name = "ProposalNotFoundError";
  }
}

// Thrown when an opportunityId does not resolve to a row visible to the
// caller's organization — e.g. ProposalService.create with a foreign or
// nonexistent opportunityId.
export class OpportunityNotFoundError extends Error {
  constructor(opportunityId: string) {
    super(`Opportunity ${opportunityId} not found`);
    this.name = "OpportunityNotFoundError";
  }
}

// Thrown when the userId supplied to a mutating endpoint does not resolve
// to an organization_members row for the request's organizationId — a
// userId that is a valid row in `users` but not a member of this
// organization must not be accepted as an author of a proposal_versions
// snapshot.
export class UserNotOrganizationMemberError extends Error {
  constructor(userId: string, organizationId: string) {
    super(`User ${userId} is not a member of organization ${organizationId}`);
    this.name = "UserNotOrganizationMemberError";
  }
}

// Thrown when a proposal_item references a rate_card_item whose Rate
// Card's creator_id does not match the creator_id of the Proposal's
// Opportunity — the per-creator catalog invariant, extended through the
// Proposal -> Opportunity -> Creator chain.
export class RateCardItemCreatorMismatchError extends Error {
  constructor(rateCardItemId: string, opportunityId: string) {
    super(
      `Rate card item ${rateCardItemId} does not belong to the creator of opportunity ${opportunityId}`,
    );
    this.name = "RateCardItemCreatorMismatchError";
  }
}

// Thrown when a proposal_items id does not resolve to a row visible to the
// caller's organization and proposal.
export class ProposalItemNotFoundError extends Error {
  constructor(itemId: string, proposalId: string) {
    super(`Proposal item ${itemId} not found on proposal ${proposalId}`);
    this.name = "ProposalItemNotFoundError";
  }
}

// Thrown when a proposal_blocks id does not resolve to a row visible to
// the caller's organization and proposal.
export class ProposalBlockNotFoundError extends Error {
  constructor(blockId: string, proposalId: string) {
    super(`Proposal block ${blockId} not found on proposal ${proposalId}`);
    this.name = "ProposalBlockNotFoundError";
  }
}
```

No test for this task in isolation — exercised by Tasks 8-14's tests.

- [ ] **Step 2: Commit**

```bash
git add src/domain/proposals
git commit -m "feat: add Proposals domain errors"
```

---

### Task 7: Infrastructure — `OrganizationMembersRepository` + `OpportunitiesRepository.findById`

**Files:**
- Create: `src/repositories/organization-members.repository.ts`
- Modify: `src/repositories/opportunities.repository.ts` (add `findById`/`findByIdWithTx`)
- Modify: `src/repositories/rate-card-items.repository.ts` (add `findById`/`findByIdWithTx`)
- Test: `src/repositories/organization-members.repository.test.ts`
- Test: extend `src/repositories/opportunities.repository.test.ts` (if it exists — check; if not, create it following this task's test)
- Test: extend `src/repositories/rate-card-items.repository.test.ts`

**Interfaces:**
- Produces: `OrganizationMembersRepository.existsForOrganization(db, organizationId, userId): Promise<boolean>` and `.existsForOrganizationWithTx(tx, organizationId, userId): Promise<boolean>` from `src/repositories/organization-members.repository.ts`.
- Produces: `OpportunitiesRepository.findById(db, organizationId, opportunityId): Promise<Opportunity | null>` and `.findByIdWithTx(tx, organizationId, opportunityId): Promise<Opportunity | null>`.
- Produces: `RateCardItemsRepository.findById(db, organizationId, itemId): Promise<RateCardItem | null>` and `.findByIdWithTx(tx, organizationId, itemId): Promise<RateCardItem | null>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/repositories/organization-members.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users, organizationMembers } from "@/db/schema/organizations";
import { OrganizationMembersRepository } from "./organization-members.repository";

describe("OrganizationMembersRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("confirms membership for a user in an organization, and denies it for a non-member", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [otherOrg] = await db.insert(organizations).values({ name: "Other" }).returning();
    const [member] = await db
      .insert(users)
      .values({ email: "member@publyflow.test", fullName: "Member" })
      .returning();
    const [stranger] = await db
      .insert(users)
      .values({ email: "stranger@publyflow.test", fullName: "Stranger" })
      .returning();
    await db.insert(organizationMembers).values({ organizationId: org.id, userId: member.id, role: "OWNER" });
    await db.insert(organizationMembers).values({ organizationId: otherOrg.id, userId: stranger.id, role: "OWNER" });

    expect(await OrganizationMembersRepository.existsForOrganization(db, org.id, member.id)).toBe(true);
    expect(await OrganizationMembersRepository.existsForOrganization(db, org.id, stranger.id)).toBe(false);
  });
});
```

Add analogous `findById`/`findByIdWithTx` tests to `src/repositories/opportunities.repository.test.ts` (create the file if it doesn't already exist — check first) and `src/repositories/rate-card-items.repository.test.ts`, each following the same "create a row, find it by id, confirm null for a nonexistent id" shape already used throughout this codebase (e.g. `src/repositories/rate-cards.repository.test.ts`'s `findById` test).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/repositories/organization-members.repository.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `OrganizationMembersRepository`**

```typescript
// src/repositories/organization-members.repository.ts
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizationMembers } from "@/db/schema/organizations";
import { runInTenantContext } from "./tenant-context";

async function selectMembership(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)));
  return Boolean(row);
}

export const OrganizationMembersRepository = {
  async existsForOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    return runInTenantContext(db, organizationId, (tx) => selectMembership(tx, organizationId, userId));
  },

  async existsForOrganizationWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    return selectMembership(tx, organizationId, userId);
  },
};
```

- [ ] **Step 4: Add `findById`/`findByIdWithTx` to `OpportunitiesRepository`**

```typescript
// src/repositories/opportunities.repository.ts
// Add this private helper near the top (after imports, alongside any
// existing private helpers) and these two public methods in the exported
// object:

async function selectOpportunityById(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  opportunityId: string,
): Promise<Opportunity | null> {
  const [opportunity] = await tx
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)));
  return opportunity ?? null;
}

// add inside the exported `OpportunitiesRepository` object:
  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
  ): Promise<Opportunity | null> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectOpportunityById(tx, organizationId, opportunityId),
    );
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
  ): Promise<Opportunity | null> {
    return selectOpportunityById(tx, organizationId, opportunityId);
  },
```

(`and`/`eq` are already imported in this file — verify before adding a duplicate import.)

- [ ] **Step 5: Add `findById`/`findByIdWithTx` to `RateCardItemsRepository`**

```typescript
// src/repositories/rate-card-items.repository.ts
// Add this private helper alongside the existing ones:

async function selectRateCardItemById(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  itemId: string,
): Promise<RateCardItem | null> {
  const [item] = await tx
    .select()
    .from(rateCardItems)
    .where(and(eq(rateCardItems.id, itemId), eq(rateCardItems.organizationId, organizationId)));
  return item ?? null;
}

// add inside the exported `RateCardItemsRepository` object:
  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
  ): Promise<RateCardItem | null> {
    return runInTenantContext(db, organizationId, (tx) => selectRateCardItemById(tx, organizationId, itemId));
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
  ): Promise<RateCardItem | null> {
    return selectRateCardItemById(tx, organizationId, itemId);
  },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/repositories/organization-members.repository.test.ts src/repositories/opportunities.repository.test.ts src/repositories/rate-card-items.repository.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite, then commit**

```bash
pnpm test
git add src/repositories
git commit -m "feat: add OrganizationMembersRepository and findById lookups for Opportunities/RateCardItems"
```

---

### Task 8: `ProposalsRepository`

**Files:**
- Create: `src/repositories/proposals.repository.ts`
- Test: `src/repositories/proposals.repository.test.ts`

**Interfaces:**
- Produces: `Proposal` type, `ProposalsRepository.create`/`createWithTx`, `.findById`/`.findByIdWithTx`, `.update`/`.updateWithTx`, `.listByOpportunity`/`.listByOpportunityWithTx` from `src/repositories/proposals.repository.ts`. `update`/`updateWithTx` throw `ProposalNotFoundError` on a 0-row match (same not-found discipline established in the Rate Cards plan's final fix).

- [ ] **Step 1: Write the failing test**

```typescript
// src/repositories/proposals.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { ProposalsRepository } from "./proposals.repository";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

describe("ProposalsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    return { org, opportunity };
  }

  it("creates, finds, updates, and lists proposals by opportunity", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, opportunity } = await setup(db);

    const created = await ProposalsRepository.create(db, org.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      template: "PREMIUM",
    });
    expect(created.status).toBe("DRAFT");

    const found = await ProposalsRepository.findById(db, org.id, created.id);
    expect(found?.id).toBe(created.id);

    const updated = await ProposalsRepository.update(db, org.id, created.id, { title: "Campanha Verão 2" });
    expect(updated.title).toBe("Campanha Verão 2");

    const list = await ProposalsRepository.listByOpportunity(db, org.id, opportunity.id);
    expect(list).toHaveLength(1);
  });

  it("throws ProposalNotFoundError when updating a nonexistent id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org } = await setup(db);

    await expect(
      ProposalsRepository.update(db, org.id, "00000000-0000-0000-0000-000000000000", { title: "X" }),
    ).rejects.toThrow(ProposalNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/proposals.repository.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the repository**

```typescript
// src/repositories/proposals.repository.ts
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposals } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

export type Proposal = typeof proposals.$inferSelect;

export interface CreateProposalInput {
  opportunityId: string;
  title: string;
  template: Proposal["template"];
}

export interface UpdateProposalInput {
  title?: string;
  template?: Proposal["template"];
  status?: Proposal["status"];
}

async function insertProposal(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateProposalInput,
): Promise<Proposal> {
  const [proposal] = await tx
    .insert(proposals)
    .values({
      organizationId,
      opportunityId: input.opportunityId,
      title: input.title,
      template: input.template,
    })
    .returning();
  return proposal;
}

async function selectProposalById(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  proposalId: string,
): Promise<Proposal | null> {
  const [proposal] = await tx
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)));
  return proposal ?? null;
}

async function updateProposal(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  proposalId: string,
  input: UpdateProposalInput,
): Promise<Proposal> {
  const [proposal] = await tx
    .update(proposals)
    .set(input)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .returning();
  if (!proposal) {
    throw new ProposalNotFoundError(proposalId);
  }
  return proposal;
}

async function selectProposalsByOpportunity(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  opportunityId: string,
): Promise<Proposal[]> {
  return tx
    .select()
    .from(proposals)
    .where(and(eq(proposals.organizationId, organizationId), eq(proposals.opportunityId, opportunityId)));
}

export const ProposalsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalInput,
  ): Promise<Proposal> {
    return runInTenantContext(db, organizationId, (tx) => insertProposal(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalInput,
  ): Promise<Proposal> {
    return insertProposal(tx, organizationId, input);
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<Proposal | null> {
    return runInTenantContext(db, organizationId, (tx) => selectProposalById(tx, organizationId, proposalId));
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<Proposal | null> {
    return selectProposalById(tx, organizationId, proposalId);
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    input: UpdateProposalInput,
  ): Promise<Proposal> {
    return runInTenantContext(db, organizationId, (tx) => updateProposal(tx, organizationId, proposalId, input));
  },

  async updateWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    input: UpdateProposalInput,
  ): Promise<Proposal> {
    return updateProposal(tx, organizationId, proposalId, input);
  },

  async listByOpportunity(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
  ): Promise<Proposal[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectProposalsByOpportunity(tx, organizationId, opportunityId),
    );
  },

  async listByOpportunityWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
  ): Promise<Proposal[]> {
    return selectProposalsByOpportunity(tx, organizationId, opportunityId);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/proposals.repository.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/repositories
git commit -m "feat: add ProposalsRepository"
```

---

### Task 9: `ProposalItemsRepository`

**Files:**
- Create: `src/repositories/proposal-items.repository.ts`
- Test: `src/repositories/proposal-items.repository.test.ts`

**Interfaces:**
- Produces: `ProposalItem` type, `ProposalItemsRepository.create`/`createWithTx`, `.update`/`.updateWithTx`, `.remove`/`.removeWithTx`, `.listByProposal`/`.listByProposalWithTx` — same `*WithTx` shape as `RateCardItemsRepository` (Task 9 of the prior plan), `update`/`remove` throw `ProposalItemNotFoundError` on a 0-row match scoped by `proposalId` (same "claimed-parent-id must match" defense as `RateCardItemsRepository.update`/`remove`).

- [ ] **Step 1: Write the failing test**

Follow the exact shape of `src/repositories/rate-card-items.repository.test.ts` (create/update/list/remove in one test), using `proposalId` in place of `rateCardId`, `description`/`unitPrice` instead of `price`, and a `proposal` fixture (via the same setup helper pattern as Task 8's test) instead of a `rateCard` fixture. Include a second test proving `update`/`remove` throw `ProposalItemNotFoundError` when the `proposalId` passed doesn't actually own the `itemId` (mirroring the Rate Cards plan's lock-bypass-fix test — create the item under proposal A, call `update`/`remove` claiming `proposalId: proposalB.id`).

```typescript
// src/repositories/proposal-items.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { ProposalsRepository } from "./proposals.repository";
import { ProposalItemsRepository } from "./proposal-items.repository";
import { ProposalItemNotFoundError } from "@/domain/proposals/errors";

describe("ProposalItemsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `thais-${Date.now()}@publyflow.test`, fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const proposal = await ProposalsRepository.create(db, org.id, {
      opportunityId: opportunity.id,
      title: "P",
      template: "PREMIUM",
    });
    return { org, proposal };
  }

  it("creates, updates, lists, and removes ad-hoc proposal items", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal } = await setup(db);

    const created = await ProposalItemsRepository.create(db, org.id, {
      proposalId: proposal.id,
      rateCardItemId: null,
      description: "Desconto negociado",
      unitPrice: -50000,
      sortOrder: 1,
    });
    expect(created.unitPrice).toBe(-50000);

    const updated = await ProposalItemsRepository.update(db, org.id, created.id, proposal.id, {
      unitPrice: -60000,
    });
    expect(updated.unitPrice).toBe(-60000);

    const list = await ProposalItemsRepository.listByProposal(db, org.id, proposal.id);
    expect(list).toHaveLength(1);

    await ProposalItemsRepository.remove(db, org.id, created.id, proposal.id);
    expect(await ProposalItemsRepository.listByProposal(db, org.id, proposal.id)).toHaveLength(0);
  });

  it("throws ProposalItemNotFoundError when the claimed proposalId does not own the item", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal: proposalA } = await setup(db);
    const { proposal: proposalB } = await setup(db);

    const item = await ProposalItemsRepository.create(db, org.id, {
      proposalId: proposalA.id,
      rateCardItemId: null,
      description: "Item",
      unitPrice: 10000,
    });

    await expect(
      ProposalItemsRepository.update(db, org.id, item.id, proposalB.id, { unitPrice: 20000 }),
    ).rejects.toThrow(ProposalItemNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/proposal-items.repository.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the repository**

Mirror `src/repositories/rate-card-items.repository.ts` exactly, substituting `proposalItems`/`ProposalItem`/`proposalId`/`ProposalItemNotFoundError` for `rateCardItems`/`RateCardItem`/`rateCardId`/`RateCardItemNotFoundError`, and the field set (`rateCardItemId`, `description`, `quantity`, `unitPrice`, `sortOrder` instead of `serviceId`, `price`, `unitDescription`, `sortOrder`):

```typescript
// src/repositories/proposal-items.repository.ts
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalItems } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";
import { ProposalItemNotFoundError } from "@/domain/proposals/errors";

export type ProposalItem = typeof proposalItems.$inferSelect;

export interface CreateProposalItemInput {
  proposalId: string;
  rateCardItemId: string | null;
  description: string;
  unitPrice: number;
  quantity?: number;
  sortOrder?: number;
}

export interface UpdateProposalItemInput {
  description?: string;
  unitPrice?: number;
  quantity?: number;
  sortOrder?: number;
}

async function insertProposalItem(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateProposalItemInput,
): Promise<ProposalItem> {
  const [item] = await tx
    .insert(proposalItems)
    .values({
      organizationId,
      proposalId: input.proposalId,
      rateCardItemId: input.rateCardItemId,
      description: input.description,
      unitPrice: input.unitPrice,
      quantity: input.quantity ?? 1,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return item;
}

async function updateProposalItem(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  itemId: string,
  proposalId: string,
  input: UpdateProposalItemInput,
): Promise<ProposalItem> {
  const [item] = await tx
    .update(proposalItems)
    .set(input)
    .where(
      and(
        eq(proposalItems.id, itemId),
        eq(proposalItems.organizationId, organizationId),
        eq(proposalItems.proposalId, proposalId),
      ),
    )
    .returning();
  if (!item) {
    throw new ProposalItemNotFoundError(itemId, proposalId);
  }
  return item;
}

async function removeProposalItem(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  itemId: string,
  proposalId: string,
): Promise<void> {
  const [item] = await tx
    .delete(proposalItems)
    .where(
      and(
        eq(proposalItems.id, itemId),
        eq(proposalItems.organizationId, organizationId),
        eq(proposalItems.proposalId, proposalId),
      ),
    )
    .returning();
  if (!item) {
    throw new ProposalItemNotFoundError(itemId, proposalId);
  }
}

async function selectProposalItemsByProposal(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  proposalId: string,
): Promise<ProposalItem[]> {
  return tx
    .select()
    .from(proposalItems)
    .where(and(eq(proposalItems.organizationId, organizationId), eq(proposalItems.proposalId, proposalId)));
}

export const ProposalItemsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalItemInput,
  ): Promise<ProposalItem> {
    return runInTenantContext(db, organizationId, (tx) => insertProposalItem(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalItemInput,
  ): Promise<ProposalItem> {
    return insertProposalItem(tx, organizationId, input);
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
    input: UpdateProposalItemInput,
  ): Promise<ProposalItem> {
    return runInTenantContext(db, organizationId, (tx) =>
      updateProposalItem(tx, organizationId, itemId, proposalId, input),
    );
  },

  async updateWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
    input: UpdateProposalItemInput,
  ): Promise<ProposalItem> {
    return updateProposalItem(tx, organizationId, itemId, proposalId, input);
  },

  async remove(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, (tx) =>
      removeProposalItem(tx, organizationId, itemId, proposalId),
    );
  },

  async removeWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
  ): Promise<void> {
    return removeProposalItem(tx, organizationId, itemId, proposalId);
  },

  async listByProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalItem[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectProposalItemsByProposal(tx, organizationId, proposalId),
    );
  },

  async listByProposalWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalItem[]> {
    return selectProposalItemsByProposal(tx, organizationId, proposalId);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/proposal-items.repository.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/repositories
git commit -m "feat: add ProposalItemsRepository"
```

---

### Task 10: `ProposalBlocksRepository`

**Files:**
- Create: `src/repositories/proposal-blocks.repository.ts`
- Test: `src/repositories/proposal-blocks.repository.test.ts`

**Interfaces:**
- Produces: `ProposalBlock` type, `ProposalBlocksRepository.create`/`createWithTx`, `.update`/`.updateWithTx`, `.remove`/`.removeWithTx`, `.listByProposal`/`.listByProposalWithTx` — identical shape to Task 9's `ProposalItemsRepository`, substituting `proposalBlocks`/`ProposalBlock`/`ProposalBlockNotFoundError` and the field set (`blockType`, `content`, `sortOrder`).

- [ ] **Step 1: Write the failing test**

Mirror Task 9's test file structure exactly (setup helper creating org+proposal, create/update/list/remove happy path, plus a "claimed proposalId doesn't own the block" rejection test), substituting block fields:

```typescript
// src/repositories/proposal-blocks.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { ProposalsRepository } from "./proposals.repository";
import { ProposalBlocksRepository } from "./proposal-blocks.repository";
import { ProposalBlockNotFoundError } from "@/domain/proposals/errors";

describe("ProposalBlocksRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `thais-${Date.now()}-${Math.random()}@publyflow.test`, fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const proposal = await ProposalsRepository.create(db, org.id, {
      opportunityId: opportunity.id,
      title: "P",
      template: "PREMIUM",
    });
    return { org, proposal };
  }

  it("creates, updates, lists, and removes blocks", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal } = await setup(db);

    const created = await ProposalBlocksRepository.create(db, org.id, {
      proposalId: proposal.id,
      blockType: "COVER",
      content: { headline: "Campanha Verão" },
      sortOrder: 1,
    });
    expect(created.blockType).toBe("COVER");

    const updated = await ProposalBlocksRepository.update(db, org.id, created.id, proposal.id, {
      content: { headline: "Novo título" },
    });
    expect(updated.content).toEqual({ headline: "Novo título" });

    const list = await ProposalBlocksRepository.listByProposal(db, org.id, proposal.id);
    expect(list).toHaveLength(1);

    await ProposalBlocksRepository.remove(db, org.id, created.id, proposal.id);
    expect(await ProposalBlocksRepository.listByProposal(db, org.id, proposal.id)).toHaveLength(0);
  });

  it("throws ProposalBlockNotFoundError when the claimed proposalId does not own the block", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal: proposalA } = await setup(db);
    const { proposal: proposalB } = await setup(db);

    const block = await ProposalBlocksRepository.create(db, org.id, {
      proposalId: proposalA.id,
      blockType: "TEXT",
      content: { body: "..." },
    });

    await expect(
      ProposalBlocksRepository.remove(db, org.id, block.id, proposalB.id),
    ).rejects.toThrow(ProposalBlockNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/proposal-blocks.repository.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the repository**

Same structure as Task 9's `ProposalItemsRepository`, with `blockType`/`content`/`sortOrder` as the mutable fields (no `quantity`/`unitPrice`):

```typescript
// src/repositories/proposal-blocks.repository.ts
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalBlocks } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";
import { ProposalBlockNotFoundError } from "@/domain/proposals/errors";

export type ProposalBlock = typeof proposalBlocks.$inferSelect;

export interface CreateProposalBlockInput {
  proposalId: string;
  blockType: ProposalBlock["blockType"];
  content: unknown;
  sortOrder?: number;
}

export interface UpdateProposalBlockInput {
  content?: unknown;
  sortOrder?: number;
}

async function insertProposalBlock(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateProposalBlockInput,
): Promise<ProposalBlock> {
  const [block] = await tx
    .insert(proposalBlocks)
    .values({
      organizationId,
      proposalId: input.proposalId,
      blockType: input.blockType,
      content: input.content,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return block;
}

async function updateProposalBlock(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  blockId: string,
  proposalId: string,
  input: UpdateProposalBlockInput,
): Promise<ProposalBlock> {
  const [block] = await tx
    .update(proposalBlocks)
    .set(input)
    .where(
      and(
        eq(proposalBlocks.id, blockId),
        eq(proposalBlocks.organizationId, organizationId),
        eq(proposalBlocks.proposalId, proposalId),
      ),
    )
    .returning();
  if (!block) {
    throw new ProposalBlockNotFoundError(blockId, proposalId);
  }
  return block;
}

async function removeProposalBlock(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  blockId: string,
  proposalId: string,
): Promise<void> {
  const [block] = await tx
    .delete(proposalBlocks)
    .where(
      and(
        eq(proposalBlocks.id, blockId),
        eq(proposalBlocks.organizationId, organizationId),
        eq(proposalBlocks.proposalId, proposalId),
      ),
    )
    .returning();
  if (!block) {
    throw new ProposalBlockNotFoundError(blockId, proposalId);
  }
}

async function selectProposalBlocksByProposal(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  proposalId: string,
): Promise<ProposalBlock[]> {
  return tx
    .select()
    .from(proposalBlocks)
    .where(and(eq(proposalBlocks.organizationId, organizationId), eq(proposalBlocks.proposalId, proposalId)));
}

export const ProposalBlocksRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalBlockInput,
  ): Promise<ProposalBlock> {
    return runInTenantContext(db, organizationId, (tx) => insertProposalBlock(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalBlockInput,
  ): Promise<ProposalBlock> {
    return insertProposalBlock(tx, organizationId, input);
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
    input: UpdateProposalBlockInput,
  ): Promise<ProposalBlock> {
    return runInTenantContext(db, organizationId, (tx) =>
      updateProposalBlock(tx, organizationId, blockId, proposalId, input),
    );
  },

  async updateWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
    input: UpdateProposalBlockInput,
  ): Promise<ProposalBlock> {
    return updateProposalBlock(tx, organizationId, blockId, proposalId, input);
  },

  async remove(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, (tx) =>
      removeProposalBlock(tx, organizationId, blockId, proposalId),
    );
  },

  async removeWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
  ): Promise<void> {
    return removeProposalBlock(tx, organizationId, blockId, proposalId);
  },

  async listByProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalBlock[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectProposalBlocksByProposal(tx, organizationId, proposalId),
    );
  },

  async listByProposalWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalBlock[]> {
    return selectProposalBlocksByProposal(tx, organizationId, proposalId);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/proposal-blocks.repository.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/repositories
git commit -m "feat: add ProposalBlocksRepository"
```

---

### Task 11: `ProposalVersionsRepository` (snapshot building + next-version-number)

**Files:**
- Create: `src/repositories/proposal-versions.repository.ts`
- Test: `src/repositories/proposal-versions.repository.test.ts`

**Interfaces:**
- Produces: `ProposalVersion` type, `ProposalSnapshot` type (`{ proposal: { title: string; template: string; status: string }; items: ProposalItem[]; blocks: ProposalBlock[] }`), `ProposalVersionsRepository.buildSnapshotWithTx(tx, organizationId, proposalId): Promise<ProposalSnapshot>`, `.createVersionWithTx(tx, organizationId, proposalId, createdBy): Promise<ProposalVersion>` (builds the snapshot via `buildSnapshotWithTx`, computes the next `versionNumber` as `1 + count of existing versions for this proposal`, inserts), `.listByProposal(db, organizationId, proposalId): Promise<ProposalVersion[]>`. This repository is the one place that knows how to assemble a full snapshot — `ProposalService`/`ProposalItemService`/`ProposalBlockService` (Tasks 12-14) call `createVersionWithTx` after deciding a version is warranted; they never build the JSON themselves.

- [ ] **Step 1: Write the failing test**

```typescript
// src/repositories/proposal-versions.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { ProposalsRepository } from "./proposals.repository";
import { ProposalItemsRepository } from "./proposal-items.repository";
import { runInTenantContext } from "./tenant-context";
import { ProposalVersionsRepository } from "./proposal-versions.repository";

describe("ProposalVersionsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `thais-${Date.now()}@publyflow.test`, fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const proposal = await ProposalsRepository.create(db, org.id, {
      opportunityId: opportunity.id,
      title: "P",
      template: "PREMIUM",
    });
    return { org, user, proposal };
  }

  it("builds a snapshot including current items, and creates sequential version numbers", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, user, proposal } = await setup(db);

    await ProposalItemsRepository.create(db, org.id, {
      proposalId: proposal.id,
      rateCardItemId: null,
      description: "Reel",
      unitPrice: 200000,
    });

    const v1 = await runInTenantContext(db, org.id, (tx) =>
      ProposalVersionsRepository.createVersionWithTx(tx, org.id, proposal.id, user.id),
    );
    expect(v1.versionNumber).toBe(1);
    expect((v1.snapshotJson as any).items).toHaveLength(1);
    expect((v1.snapshotJson as any).proposal.title).toBe("P");

    const v2 = await runInTenantContext(db, org.id, (tx) =>
      ProposalVersionsRepository.createVersionWithTx(tx, org.id, proposal.id, user.id),
    );
    expect(v2.versionNumber).toBe(2);

    const list = await ProposalVersionsRepository.listByProposal(db, org.id, proposal.id);
    expect(list).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/proposal-versions.repository.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the repository**

```typescript
// src/repositories/proposal-versions.repository.ts
import { and, count, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposals, proposalVersions } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";
import { ProposalsRepository } from "./proposals.repository";
import { ProposalItemsRepository, type ProposalItem } from "./proposal-items.repository";
import { ProposalBlocksRepository, type ProposalBlock } from "./proposal-blocks.repository";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

export type ProposalVersion = typeof proposalVersions.$inferSelect;

export interface ProposalSnapshot {
  proposal: { title: string; template: string; status: string };
  items: ProposalItem[];
  blocks: ProposalBlock[];
}

export const ProposalVersionsRepository = {
  async buildSnapshotWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalSnapshot> {
    const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
    if (!proposal) {
      throw new ProposalNotFoundError(proposalId);
    }
    const items = await ProposalItemsRepository.listByProposalWithTx(tx, organizationId, proposalId);
    const blocks = await ProposalBlocksRepository.listByProposalWithTx(tx, organizationId, proposalId);
    return {
      proposal: { title: proposal.title, template: proposal.template, status: proposal.status },
      items,
      blocks,
    };
  },

  async createVersionWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    createdBy: string,
  ): Promise<ProposalVersion> {
    const snapshot = await ProposalVersionsRepository.buildSnapshotWithTx(tx, organizationId, proposalId);

    const [{ value: existingCount }] = await tx
      .select({ value: count() })
      .from(proposalVersions)
      .where(and(eq(proposalVersions.proposalId, proposalId), eq(proposalVersions.organizationId, organizationId)));

    const [version] = await tx
      .insert(proposalVersions)
      .values({
        organizationId,
        proposalId,
        versionNumber: existingCount + 1,
        snapshotJson: snapshot,
        createdBy,
      })
      .returning();
    return version;
  },

  async listByProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalVersion[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(proposalVersions)
        .where(and(eq(proposalVersions.organizationId, organizationId), eq(proposalVersions.proposalId, proposalId)));
    });
  },
};
```

Note: `existingCount + 1` inside the caller's transaction, combined with the `UNIQUE (proposal_id, version_number)` constraint from Task 5, means a genuine concurrent race (two overlapping transactions both computing the same count) surfaces as a constraint-violation error on the second `INSERT`, rather than silently corrupting the sequence — acceptable for this plan per the design spec's residual-race note; not retried automatically here.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/proposal-versions.repository.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repositories
git commit -m "feat: add ProposalVersionsRepository with snapshot building and sequential version numbers"
```

---

### Task 12: `ProposalService` (create, update, membership validation)

**Files:**
- Create: `src/services/proposal.service.ts`
- Test: `src/services/proposal.service.test.ts`

**Interfaces:**
- Consumes: `ProposalsRepository` (Task 8), `ProposalVersionsRepository` (Task 11), `OpportunitiesRepository.findByIdWithTx` (Task 7), `OrganizationMembersRepository.existsForOrganizationWithTx` (Task 7).
- Produces: `ProposalService.create(db, organizationId, input: { opportunityId: string; title: string; template: Proposal["template"]; userId: string }): Promise<Proposal>` — validates the `userId` is an organization member and the `opportunityId` resolves, creates the proposal AND its version-1 snapshot atomically. `ProposalService.update(db, organizationId, proposalId, input: { title?: string; template?: Proposal["template"]; status?: Proposal["status"]; userId: string }): Promise<Proposal>` — validates membership, updates, and writes a new version ONLY if `title`/`template`/`status` actually changed.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/proposal.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ProposalService } from "./proposal.service";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { UserNotOrganizationMemberError, OpportunityNotFoundError } from "@/domain/proposals/errors";
import { organizations, users } from "@/db/schema/organizations";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("ProposalService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Thais",
      displayName: "Thais",
    });
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({
        organizationId: organization.id,
        creatorId: creator.id,
        leadId: lead.id,
        companyId: null,
        brandId: null,
      })
      .returning();
    return { organization, owner, opportunity };
  }

  it("creates a proposal with an initial version snapshot", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity } = await setup(db);

    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: owner.id,
    });

    expect(proposal.status).toBe("DRAFT");

    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
    expect((versions[0].snapshotJson as any).proposal.title).toBe("Campanha Verão");
  });

  it("rejects create when userId is not a member of the organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, opportunity } = await setup(db);

    const [stranger] = await db
      .insert(users)
      .values({ email: `stranger-${Date.now()}@publyflow.test`, fullName: "Stranger" })
      .returning();

    await expect(
      ProposalService.create(db, organization.id, {
        opportunityId: opportunity.id,
        title: "X",
        template: "PREMIUM",
        userId: stranger.id,
      }),
    ).rejects.toThrow(UserNotOrganizationMemberError);
  });

  it("rejects create when the opportunityId belongs to another organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await setup(db);
    const { opportunity: foreignOpportunity } = await setup(db);

    await expect(
      ProposalService.create(db, organization.id, {
        opportunityId: foreignOpportunity.id,
        title: "X",
        template: "PREMIUM",
        userId: owner.id,
      }),
    ).rejects.toThrow(OpportunityNotFoundError);
  });

  it("does not write a new version when update doesn't change anything", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity } = await setup(db);

    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: owner.id,
    });

    await ProposalService.update(db, organization.id, proposal.id, {
      title: "Campanha Verão",
      userId: owner.id,
    });

    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(1);
  });

  it("writes a new version when update changes the title", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity } = await setup(db);

    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: owner.id,
    });

    await ProposalService.update(db, organization.id, proposal.id, {
      title: "Campanha Verão 2",
      userId: owner.id,
    });

    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/proposal.service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the service**

```typescript
// src/services/proposal.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository, type Proposal, type CreateProposalInput, type UpdateProposalInput } from "@/repositories/proposals.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { UserNotOrganizationMemberError, OpportunityNotFoundError } from "@/domain/proposals/errors";

async function assertMember(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  userId: string,
): Promise<void> {
  const isMember = await OrganizationMembersRepository.existsForOrganizationWithTx(tx, organizationId, userId);
  if (!isMember) {
    throw new UserNotOrganizationMemberError(userId, organizationId);
  }
}

export interface CreateProposalServiceInput extends CreateProposalInput {
  userId: string;
}

export interface UpdateProposalServiceInput extends UpdateProposalInput {
  userId: string;
}

export const ProposalService = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalServiceInput,
  ): Promise<Proposal> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, input.opportunityId);
      if (!opportunity) {
        throw new OpportunityNotFoundError(input.opportunityId);
      }

      const proposal = await ProposalsRepository.createWithTx(tx, organizationId, {
        opportunityId: input.opportunityId,
        title: input.title,
        template: input.template,
      });

      await ProposalVersionsRepository.createVersionWithTx(tx, organizationId, proposal.id, input.userId);

      return proposal;
    });
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    input: UpdateProposalServiceInput,
  ): Promise<Proposal> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const before = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
      const after = await ProposalsRepository.updateWithTx(tx, organizationId, proposalId, {
        title: input.title,
        template: input.template,
        status: input.status,
      });

      const changed =
        !before ||
        before.title !== after.title ||
        before.template !== after.template ||
        before.status !== after.status;

      if (changed) {
        await ProposalVersionsRepository.createVersionWithTx(tx, organizationId, proposalId, input.userId);
      }

      return after;
    });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/proposal.service.test.ts`
Expected: PASS (all five tests)

- [ ] **Step 5: Run the full suite, then commit**

```bash
pnpm test
git add src/services
git commit -m "feat: add ProposalService with membership/opportunity validation and conditional versioning"
```

---

### Task 13: `ProposalItemService` (catalog validation, lock trigger, conditional versioning)

**Files:**
- Create: `src/services/proposal-item.service.ts`
- Test: `src/services/proposal-item.service.test.ts`

**Interfaces:**
- Consumes: `ProposalItemsRepository` (Task 9), `ProposalsRepository.findByIdWithTx` (Task 8), `ProposalVersionsRepository` (Task 11), `OpportunitiesRepository.findByIdWithTx` (Task 7), `RateCardItemsRepository.findByIdWithTx` (Task 7), `RateCardsRepository.findByIdWithTx`/`setLockedWithTx` (Task 1 + prior plan), `OrganizationMembersRepository` (Task 7).
- Produces: `ProposalItemService.addItem(db, organizationId, input: AddProposalItemInput): Promise<ProposalItem>`, `.updateItem(db, organizationId, itemId, proposalId, input: { description?, unitPrice?, quantity?, sortOrder?, userId })`, `.removeItem(db, organizationId, itemId, proposalId, userId)`, where `AddProposalItemInput = { proposalId: string; quantity?: number; sortOrder?: number; userId: string } & ({ rateCardItemId: string } | { rateCardItemId?: undefined; description: string; unitPrice: number })` — a discriminated union mirroring the `contact` union already used in `CommercialInquiryService.resolve` elsewhere in this codebase.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/proposal-item.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ServiceService } from "./service.service";
import { RateCardService } from "./rate-card.service";
import { ProposalService } from "./proposal.service";
import { ProposalItemService } from "./proposal-item.service";
import { RateCardsRepository } from "@/repositories/rate-cards.repository";
import { RateCardItemsRepository } from "@/repositories/rate-card-items.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { RateCardItemCreatorMismatchError } from "@/domain/proposals/errors";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("ProposalItemService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Thais",
      displayName: "Thais",
    });
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: organization.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "P",
      template: "PREMIUM",
      userId: owner.id,
    });
    return { organization, owner, creator, opportunity, proposal };
  }

  it("adds an ad-hoc item and writes a new version, without touching any rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    const item = await ProposalItemService.addItem(db, organization.id, {
      proposalId: proposal.id,
      description: "Desconto negociado",
      unitPrice: -50000,
      userId: owner.id,
    });

    expect(item.rateCardItemId).toBeNull();

    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(2); // version 1 at proposal creation, version 2 for this item
  });

  it("adds a catalog item, copies its price, and locks the source rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal } = await setup(db);

    const service = await ServiceService.create(db, organization.id, { creatorId: creator.id, name: "01 Reel" });
    const rateCard = await RateCardService.create(db, organization.id, { creatorId: creator.id, name: "Tabela" });
    const rateCardItem = await RateCardItemsRepository.create(db, organization.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    const item = await ProposalItemService.addItem(db, organization.id, {
      proposalId: proposal.id,
      rateCardItemId: rateCardItem.id,
      userId: owner.id,
    });

    expect(item.unitPrice).toBe(200000);
    expect(item.description).toBe("01 Reel");

    const lockedCard = await RateCardsRepository.findById(db, organization.id, rateCard.id);
    expect(lockedCard?.isLocked).toBe(true);
    expect(lockedCard?.lockedAt).not.toBeNull();
  });

  it("rejects a rate card item whose rate card belongs to a different creator than the opportunity", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    const otherCreator = await CreatorService.onboardCreator(db, organization.id, {
      email: `other-${Date.now()}@publyflow.test`,
      fullName: "Outro Creator",
      displayName: "Outro Creator",
    });
    const service = await ServiceService.create(db, organization.id, {
      creatorId: otherCreator.id,
      name: "01 Reel",
    });
    const rateCard = await RateCardService.create(db, organization.id, {
      creatorId: otherCreator.id,
      name: "Tabela do outro creator",
    });
    const rateCardItem = await RateCardItemsRepository.create(db, organization.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 100000,
    });

    await expect(
      ProposalItemService.addItem(db, organization.id, {
        proposalId: proposal.id,
        rateCardItemId: rateCardItem.id,
        userId: owner.id,
      }),
    ).rejects.toThrow(RateCardItemCreatorMismatchError);
  });

  it("does not write a new version when update doesn't change anything", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    const item = await ProposalItemService.addItem(db, organization.id, {
      proposalId: proposal.id,
      description: "Item",
      unitPrice: 10000,
      userId: owner.id,
    });
    const versionsAfterAdd = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);

    await ProposalItemService.updateItem(db, organization.id, item.id, proposal.id, {
      unitPrice: 10000,
      userId: owner.id,
    });

    const versionsAfterNoopUpdate = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versionsAfterNoopUpdate).toHaveLength(versionsAfterAdd.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/proposal-item.service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the service**

```typescript
// src/services/proposal-item.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import {
  ProposalItemsRepository,
  type ProposalItem,
  type UpdateProposalItemInput,
} from "@/repositories/proposal-items.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { RateCardItemsRepository } from "@/repositories/rate-card-items.repository";
import { RateCardsRepository } from "@/repositories/rate-cards.repository";
import { ServicesRepository } from "@/repositories/services.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import {
  ProposalNotFoundError,
  OpportunityNotFoundError,
  RateCardItemCreatorMismatchError,
  UserNotOrganizationMemberError,
} from "@/domain/proposals/errors";
import { RateCardItemNotFoundError } from "@/domain/rate-cards/errors";

async function assertMember(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  userId: string,
): Promise<void> {
  const isMember = await OrganizationMembersRepository.existsForOrganizationWithTx(tx, organizationId, userId);
  if (!isMember) {
    throw new UserNotOrganizationMemberError(userId, organizationId);
  }
}

export type AddProposalItemInput = {
  proposalId: string;
  quantity?: number;
  sortOrder?: number;
  userId: string;
} & (
  | { rateCardItemId: string; description?: undefined; unitPrice?: undefined }
  | { rateCardItemId?: undefined; description: string; unitPrice: number }
);

export interface UpdateProposalItemServiceInput extends UpdateProposalItemInput {
  userId: string;
}

export const ProposalItemService = {
  async addItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: AddProposalItemInput,
  ): Promise<ProposalItem> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, input.proposalId);
      if (!proposal) {
        throw new ProposalNotFoundError(input.proposalId);
      }

      let description: string;
      let unitPrice: number;
      let rateCardItemId: string | null = null;

      if (input.rateCardItemId) {
        const rateCardItem = await RateCardItemsRepository.findByIdWithTx(tx, organizationId, input.rateCardItemId);
        if (!rateCardItem) {
          throw new RateCardItemNotFoundError(input.rateCardItemId, "");
        }

        const rateCard = await RateCardsRepository.findByIdWithTx(tx, organizationId, rateCardItem.rateCardId);
        if (!rateCard) {
          throw new RateCardItemNotFoundError(input.rateCardItemId, rateCardItem.rateCardId);
        }

        const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, proposal.opportunityId);
        if (!opportunity) {
          throw new OpportunityNotFoundError(proposal.opportunityId);
        }

        if (rateCard.creatorId !== opportunity.creatorId) {
          throw new RateCardItemCreatorMismatchError(input.rateCardItemId, proposal.opportunityId);
        }

        const service = await ServicesRepository.findByIdWithTx(tx, organizationId, rateCardItem.serviceId);
        description = service?.name ?? "";
        unitPrice = rateCardItem.price;
        rateCardItemId = rateCardItem.id;

        if (!rateCard.isLocked) {
          await RateCardsRepository.setLockedWithTx(tx, organizationId, rateCard.id, true);
        }
      } else {
        description = input.description;
        unitPrice = input.unitPrice;
      }

      const item = await ProposalItemsRepository.createWithTx(tx, organizationId, {
        proposalId: input.proposalId,
        rateCardItemId,
        description,
        unitPrice,
        quantity: input.quantity,
        sortOrder: input.sortOrder,
      });

      await ProposalVersionsRepository.createVersionWithTx(tx, organizationId, input.proposalId, input.userId);

      return item;
    });
  },

  async updateItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
    input: UpdateProposalItemServiceInput,
  ): Promise<ProposalItem> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const items = await ProposalItemsRepository.listByProposalWithTx(tx, organizationId, proposalId);
      const before = items.find((row) => row.id === itemId) ?? null;

      const after = await ProposalItemsRepository.updateWithTx(tx, organizationId, itemId, proposalId, {
        description: input.description,
        unitPrice: input.unitPrice,
        quantity: input.quantity,
        sortOrder: input.sortOrder,
      });

      const changed =
        !before ||
        before.description !== after.description ||
        before.unitPrice !== after.unitPrice ||
        before.quantity !== after.quantity ||
        before.sortOrder !== after.sortOrder;

      if (changed) {
        await ProposalVersionsRepository.createVersionWithTx(tx, organizationId, proposalId, input.userId);
      }

      return after;
    });
  },

  async removeItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
    userId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, userId);
      await ProposalItemsRepository.removeWithTx(tx, organizationId, itemId, proposalId);
      await ProposalVersionsRepository.createVersionWithTx(tx, organizationId, proposalId, userId);
    });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/proposal-item.service.test.ts`
Expected: PASS (all five tests)

- [ ] **Step 5: Run the full suite, then commit**

```bash
pnpm test
git add src/services
git commit -m "feat: add ProposalItemService with catalog validation, lock-on-first-use, and conditional versioning"
```

---

### Task 14: `ProposalBlockService`

**Files:**
- Create: `src/services/proposal-block.service.ts`
- Test: `src/services/proposal-block.service.test.ts`

**Interfaces:**
- Consumes: `ProposalBlocksRepository` (Task 10), `ProposalsRepository.findByIdWithTx` (Task 8), `ProposalVersionsRepository` (Task 11), `OrganizationMembersRepository` (Task 7).
- Produces: `ProposalBlockService.addBlock(db, organizationId, input: { proposalId: string; blockType: ProposalBlock["blockType"]; content: unknown; sortOrder?: number; userId: string }): Promise<ProposalBlock>`, `.updateBlock(db, organizationId, blockId, proposalId, input: { content?, sortOrder?, userId })`, `.removeBlock(db, organizationId, blockId, proposalId, userId)` — same conditional-versioning shape as `ProposalItemService`, no lock-trigger logic (blocks never reference a rate card).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/proposal-block.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ProposalService } from "./proposal.service";
import { ProposalBlockService } from "./proposal-block.service";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("ProposalBlockService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Thais",
      displayName: "Thais",
    });
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: organization.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "P",
      template: "PREMIUM",
      userId: owner.id,
    });
    return { organization, owner, proposal };
  }

  it("adds a block and writes a new version", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    const block = await ProposalBlockService.addBlock(db, organization.id, {
      proposalId: proposal.id,
      blockType: "COVER",
      content: { headline: "Campanha Verão" },
      userId: owner.id,
    });

    expect(block.blockType).toBe("COVER");

    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(2);
  });

  it("does not write a new version when update doesn't change anything", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    const block = await ProposalBlockService.addBlock(db, organization.id, {
      proposalId: proposal.id,
      blockType: "TEXT",
      content: { body: "..." },
      userId: owner.id,
    });
    const versionsAfterAdd = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);

    await ProposalBlockService.updateBlock(db, organization.id, block.id, proposal.id, {
      content: { body: "..." },
      userId: owner.id,
    });

    const versionsAfterNoopUpdate = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versionsAfterNoopUpdate).toHaveLength(versionsAfterAdd.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/proposal-block.service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the service**

```typescript
// src/services/proposal-block.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import {
  ProposalBlocksRepository,
  type ProposalBlock,
  type CreateProposalBlockInput,
  type UpdateProposalBlockInput,
} from "@/repositories/proposal-blocks.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { ProposalNotFoundError, UserNotOrganizationMemberError } from "@/domain/proposals/errors";

async function assertMember(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  userId: string,
): Promise<void> {
  const isMember = await OrganizationMembersRepository.existsForOrganizationWithTx(tx, organizationId, userId);
  if (!isMember) {
    throw new UserNotOrganizationMemberError(userId, organizationId);
  }
}

export interface AddProposalBlockInput extends CreateProposalBlockInput {
  userId: string;
}

export interface UpdateProposalBlockServiceInput extends UpdateProposalBlockInput {
  userId: string;
}

function contentEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const ProposalBlockService = {
  async addBlock(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: AddProposalBlockInput,
  ): Promise<ProposalBlock> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, input.proposalId);
      if (!proposal) {
        throw new ProposalNotFoundError(input.proposalId);
      }

      const block = await ProposalBlocksRepository.createWithTx(tx, organizationId, {
        proposalId: input.proposalId,
        blockType: input.blockType,
        content: input.content,
        sortOrder: input.sortOrder,
      });

      await ProposalVersionsRepository.createVersionWithTx(tx, organizationId, input.proposalId, input.userId);

      return block;
    });
  },

  async updateBlock(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
    input: UpdateProposalBlockServiceInput,
  ): Promise<ProposalBlock> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const blocks = await ProposalBlocksRepository.listByProposalWithTx(tx, organizationId, proposalId);
      const before = blocks.find((row) => row.id === blockId) ?? null;

      const after = await ProposalBlocksRepository.updateWithTx(tx, organizationId, blockId, proposalId, {
        content: input.content,
        sortOrder: input.sortOrder,
      });

      const changed =
        !before || !contentEqual(before.content, after.content) || before.sortOrder !== after.sortOrder;

      if (changed) {
        await ProposalVersionsRepository.createVersionWithTx(tx, organizationId, proposalId, input.userId);
      }

      return after;
    });
  },

  async removeBlock(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
    userId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, userId);
      await ProposalBlocksRepository.removeWithTx(tx, organizationId, blockId, proposalId);
      await ProposalVersionsRepository.createVersionWithTx(tx, organizationId, proposalId, userId);
    });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/proposal-block.service.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Run the full suite, then commit**

```bash
pnpm test
git add src/services
git commit -m "feat: add ProposalBlockService with conditional versioning"
```

---

### Task 15: API routes — Proposals + version history

**Files:**
- Create: `src/app/api/proposals/route.ts` (POST, GET)
- Create: `src/app/api/proposals/[id]/route.ts` (PATCH)
- Create: `src/app/api/proposals/[id]/versions/route.ts` (GET)
- Test: `src/app/api/proposals/route.test.ts`

**Interfaces:**
- Produces: `POST /api/proposals` accepting `{ organizationId, opportunityId, title, template, userId }`, `201`. `GET /api/proposals?organizationId=&opportunityId=`, `200`. `PATCH /api/proposals/:id` accepting `{ organizationId, title?, template?, status?, userId }`, `200`. `GET /api/proposals/:id/versions?organizationId=`, `200` with `ProposalVersion[]`.

- [ ] **Step 1: Write the failing test**

Follow the exact shape of `src/app/api/rate-cards/route.test.ts` (Task 12 of the prior plan): `vi.doMock("@/db")`, seed org/creator/opportunity via direct inserts (mirroring the setup helpers used throughout this plan's service tests), dynamic import of the route, assert `201` and the response body's `title`/`status`.

```typescript
// src/app/api/proposals/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("POST /api/proposals", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the created proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });
    const [contact] = await db.insert(contacts).values({ organizationId: organization.id, fullName: "Maria" }).returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: organization.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();

    const { POST } = await import("./route");

    const request = new Request("http://localhost/api/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        opportunityId: opportunity.id,
        title: "Campanha Verão",
        template: "PREMIUM",
        userId: owner.id,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.title).toBe("Campanha Verão");
    expect(json.status).toBe("DRAFT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/proposals/route.test.ts`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 3: Implement the routes**

```typescript
// src/app/api/proposals/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalService } from "@/services/proposal.service";
import { ProposalsRepository } from "@/repositories/proposals.repository";

const templateEnum = z.enum(["PREMIUM", "MINIMAL", "EDITORIAL", "FASHION", "BEAUTY", "CORPORATE"]);

const createSchema = z.object({
  organizationId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  title: z.string().min(1),
  template: templateEnum,
  userId: z.string().uuid(),
});

export async function POST(request: Request) {
  const payload = createSchema.parse(await request.json());
  const proposal = await ProposalService.create(db, payload.organizationId, {
    opportunityId: payload.opportunityId,
    title: payload.title,
    template: payload.template,
    userId: payload.userId,
  });
  return NextResponse.json(proposal, { status: 201 });
}

const listQuerySchema = z.object({
  organizationId: z.string().uuid(),
  opportunityId: z.string().uuid(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = listQuerySchema.parse({
    organizationId: url.searchParams.get("organizationId"),
    opportunityId: url.searchParams.get("opportunityId"),
  });
  const list = await ProposalsRepository.listByOpportunity(db, payload.organizationId, payload.opportunityId);
  return NextResponse.json(list, { status: 200 });
}
```

```typescript
// src/app/api/proposals/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalService } from "@/services/proposal.service";

const templateEnum = z.enum(["PREMIUM", "MINIMAL", "EDITORIAL", "FASHION", "BEAUTY", "CORPORATE"]);
const statusEnum = z.enum(["DRAFT", "ARCHIVED"]);

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  title: z.string().min(1).optional(),
  template: templateEnum.optional(),
  status: statusEnum.optional(),
  userId: z.string().uuid(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = updateSchema.parse(await request.json());
  const { organizationId, ...input } = payload;
  const proposal = await ProposalService.update(db, organizationId, id, input);
  return NextResponse.json(proposal, { status: 200 });
}
```

```typescript
// src/app/api/proposals/[id]/versions/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });
  const versions = await ProposalVersionsRepository.listByProposal(db, payload.organizationId, id);
  return NextResponse.json(versions, { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/proposals/route.test.ts`
Expected: PASS

- [ ] **Step 5: Verify the app still builds**

Run: `OPENAI_API_KEY=test JEV_API_KEY=test pnpm build`
Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/proposals
git commit -m "feat: expose Proposals create/list/update and version history as API routes"
```

---

### Task 16: API routes — Proposal Items + Proposal Blocks

**Files:**
- Create: `src/app/api/proposals/[id]/items/route.ts` (POST)
- Create: `src/app/api/proposal-items/[id]/route.ts` (PATCH, DELETE)
- Create: `src/app/api/proposals/[id]/blocks/route.ts` (POST)
- Create: `src/app/api/proposal-blocks/[id]/route.ts` (PATCH, DELETE)
- Test: `src/app/api/proposals/[id]/items/route.test.ts`

**Interfaces:**
- Produces: `POST /api/proposals/:id/items` accepting `{ organizationId, userId, quantity?, sortOrder?, rateCardItemId }` OR `{ organizationId, userId, quantity?, sortOrder?, description, unitPrice }`, `201`, mapping `RateCardItemCreatorMismatchError`/`OpportunityNotFoundError`/`ProposalNotFoundError` to `404` and `RateCardItemNotFoundError` to `404`. `PATCH`/`DELETE /api/proposal-items/:id` accepting `{ organizationId, proposalId, userId, ... }`. `POST /api/proposals/:id/blocks` accepting `{ organizationId, userId, blockType, content, sortOrder? }`, `201`. `PATCH`/`DELETE /api/proposal-blocks/:id` accepting `{ organizationId, proposalId, userId, ... }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/proposals/[id]/items/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ProposalService } from "@/services/proposal.service";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("POST /api/proposals/:id/items", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the created ad-hoc item", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });
    const [contact] = await db.insert(contacts).values({ organizationId: organization.id, fullName: "Maria" }).returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: organization.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "P",
      template: "PREMIUM",
      userId: owner.id,
    });

    const { POST } = await import("./route");

    const request = new Request(`http://localhost/api/proposals/${proposal.id}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        userId: owner.id,
        description: "Desconto negociado",
        unitPrice: -50000,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: proposal.id }) });
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.description).toBe("Desconto negociado");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run "src/app/api/proposals/[id]/items/route.test.ts"`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 3: Implement the routes**

```typescript
// src/app/api/proposals/[id]/items/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalItemService } from "@/services/proposal-item.service";
import {
  ProposalNotFoundError,
  OpportunityNotFoundError,
  RateCardItemCreatorMismatchError,
} from "@/domain/proposals/errors";
import { RateCardItemNotFoundError } from "@/domain/rate-cards/errors";

const catalogSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  rateCardItemId: z.string().uuid(),
  quantity: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
});

const adHocSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  description: z.string().min(1),
  unitPrice: z.number().int(),
  quantity: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
});

const bodySchema = z.union([catalogSchema, adHocSchema]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());

  try {
    const item = await ProposalItemService.addItem(db, payload.organizationId, {
      proposalId: id,
      quantity: payload.quantity,
      sortOrder: payload.sortOrder,
      userId: payload.userId,
      ...("rateCardItemId" in payload
        ? { rateCardItemId: payload.rateCardItemId }
        : { description: payload.description, unitPrice: payload.unitPrice }),
    } as Parameters<typeof ProposalItemService.addItem>[2]);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (
      error instanceof ProposalNotFoundError ||
      error instanceof OpportunityNotFoundError ||
      error instanceof RateCardItemNotFoundError
    ) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RateCardItemCreatorMismatchError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
```

```typescript
// src/app/api/proposal-items/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalItemService } from "@/services/proposal-item.service";
import { ProposalItemNotFoundError } from "@/domain/proposals/errors";

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  proposalId: z.string().uuid(),
  userId: z.string().uuid(),
  description: z.string().min(1).optional(),
  unitPrice: z.number().int().optional(),
  quantity: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = updateSchema.parse(await request.json());
  const { organizationId, proposalId, ...input } = payload;

  try {
    const item = await ProposalItemService.updateItem(db, organizationId, id, proposalId, input);
    return NextResponse.json(item, { status: 200 });
  } catch (error) {
    if (error instanceof ProposalItemNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

const deleteSchema = z.object({
  organizationId: z.string().uuid(),
  proposalId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = deleteSchema.parse(await request.json());

  try {
    await ProposalItemService.removeItem(db, payload.organizationId, id, payload.proposalId, payload.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ProposalItemNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
```

```typescript
// src/app/api/proposals/[id]/blocks/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalBlockService } from "@/services/proposal-block.service";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

const blockTypeEnum = z.enum([
  "COVER",
  "TEXT",
  "IMAGE",
  "METRICS",
  "SERVICES",
  "PRICING",
  "TIMELINE",
  "GALLERY",
  "TESTIMONIALS",
  "SOCIAL_LINKS",
  "FOOTER",
]);

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  blockType: blockTypeEnum,
  content: z.unknown(),
  sortOrder: z.number().int().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());

  try {
    const block = await ProposalBlockService.addBlock(db, payload.organizationId, {
      proposalId: id,
      blockType: payload.blockType,
      content: payload.content,
      sortOrder: payload.sortOrder,
      userId: payload.userId,
    });
    return NextResponse.json(block, { status: 201 });
  } catch (error) {
    if (error instanceof ProposalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
```

```typescript
// src/app/api/proposal-blocks/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalBlockService } from "@/services/proposal-block.service";
import { ProposalBlockNotFoundError } from "@/domain/proposals/errors";

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  proposalId: z.string().uuid(),
  userId: z.string().uuid(),
  content: z.unknown().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = updateSchema.parse(await request.json());
  const { organizationId, proposalId, ...input } = payload;

  try {
    const block = await ProposalBlockService.updateBlock(db, organizationId, id, proposalId, input);
    return NextResponse.json(block, { status: 200 });
  } catch (error) {
    if (error instanceof ProposalBlockNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

const deleteSchema = z.object({
  organizationId: z.string().uuid(),
  proposalId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = deleteSchema.parse(await request.json());

  try {
    await ProposalBlockService.removeBlock(db, payload.organizationId, id, payload.proposalId, payload.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ProposalBlockNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run "src/app/api/proposals/[id]/items/route.test.ts"`
Expected: PASS

- [ ] **Step 5: Verify the app still builds, run the FULL suite one last time**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test pnpm build
pnpm test
```

Expected: both clean — this is the last task in the plan.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/proposals src/app/api/proposal-items src/app/api/proposal-blocks
git commit -m "feat: expose Proposal Items and Proposal Blocks as API routes"
```

---

## Self-Review

**Spec coverage:**
- Decisão #1 (ad-hoc items) — Task 3 schema (`rateCardItemId` nullable), Task 13 (`AddProposalItemInput` union).
- Decisão #2 (lock-on-first-use, `locked_at`) — Task 1 (`locked_at`, `setLockedWithTx`), Task 13 (`addItem`'s lock trigger).
- Decisão #3/#4 (fixed enums for block type / template) — Tasks 2 and 4 schema.
- Decisão #5 (no fixed `rate_card_id` on `proposals`) — Task 2 schema correctly omits it.
- Decisão #6 (automatic conditional versioning) — Task 11 (`createVersionWithTx`), Tasks 12-14 (before/after comparison in every service method, including the two "no-op update" tests proving no spurious version is written).
- Decisão #7 (`DRAFT`/`ARCHIVED` only) — Task 2 schema.
- Decisão #8 (`userId` in body, membership validated via `organization_members`, not just the `users` FK) — Task 7 (`OrganizationMembersRepository`), Tasks 12-14 (`assertMember` in every mutating method).
- Decisão #9 (`creator_id` validation via Opportunity) — Task 13 (`addItem`'s `rateCard.creatorId !== opportunity.creatorId` check).
- `UNIQUE(proposal_id, version_number)` — Task 5 schema.
- §5 API Routes — Tasks 15-16 cover every route listed in the spec.
- §6 Pendências — AI generation, PDF, public sharing, `SENT`/`APPROVED`/`REJECTED`, real-time collaboration are correctly absent from every task.

**Placeholder scan:** no TBD/TODO; every step has concrete code or, where a test file is
explicitly said to "mirror" an earlier task's exact structure (Tasks 3-4, 9-10's second RLS
test), the referenced file and the specific substitutions needed are named precisely enough
to write without invention.

**Type consistency:** `Proposal`, `ProposalItem`, `ProposalBlock`, `ProposalVersion`,
`ProposalSnapshot` are each defined once (via `$inferSelect`) and reused by name across
later tasks. `ProposalItemService.addItem`'s `AddProposalItemInput` discriminated union is
used consistently in Task 13's service and Task 16's route (`"rateCardItemId" in payload`
narrows correctly against both Zod schema variants). `*WithTx` method names and parameter
order (`tx, organizationId, ...`) are consistent with the established convention from the
two prior plans throughout.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-proposals-core.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
