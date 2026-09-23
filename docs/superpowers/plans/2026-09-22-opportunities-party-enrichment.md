# Opportunities Party Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `GET /api/opportunities` return `companyName`, `brandName`, and `contactName`
alongside the existing raw IDs, so the Pipeline UX Spec can be designed against real data
instead of raw UUIDs.

**Architecture:** `OpportunitiesRepository.listByCreator` gains `LEFT JOIN`s to `companies`/
`brands` (nullable FKs) and `INNER JOIN`s to `leads`/`contacts` (`NOT NULL` FKs), returning a
new `OpportunityWithParties` type. The service and route layers already pass the list through
unmodified, so they need only a type update (service) or nothing at all (route) — same shape
of change as the Commercial Inquiries message enrichment plan this mirrors.

**Tech Stack:** Drizzle ORM, PostgreSQL, Vitest.

## Global Constraints

- Same signature: `listByCreator(db, organizationId, creatorId, stage?)` at both repository
  and service layers — no new parameters.
- Same ordering (`createdAt desc`) and same optional `stage` filter — unchanged behavior, only
  the returned shape grows.
- `companies`/`brands` joins are `LEFT JOIN` (`opportunities.companyId`/`brandId` are
  nullable) — an `INNER JOIN` would silently drop opportunities with no company/brand.
- `leads`/`contacts` joins are `INNER JOIN` (`opportunities.leadId` and `leads.contactId` are
  both `NOT NULL`) — cannot silently drop a row.
- No new route, no `GET /api/opportunities/:id` enrichment, no change to
  `PATCH /api/opportunities/:id` — this plan only changes the response shape of the existing
  `GET /api/opportunities` list endpoint.
- Deciding which of `companyName`/`brandName`/`contactName` is the card's primary display
  label is a Pipeline UX/frontend concern, not addressed here — no `displayName` field is
  added to the backend.

---

### Task 1: Enrich `listByCreator` with company/brand/contact names

**Files:**
- Modify: `src/repositories/opportunities.repository.ts`
- Modify: `src/services/opportunity.service.ts`
- Test: `src/repositories/opportunities.repository.test.ts`
- Test: `src/app/api/opportunities/route.test.ts`

**Interfaces:**
- Produces: `OpportunityWithParties` type from `src/repositories/opportunities.repository.ts`
  — `Opportunity` (all existing fields) plus `companyName: string | null`,
  `brandName: string | null`, `contactName: string`.
- Modifies: `OpportunitiesRepository.listByCreator(db, organizationId, creatorId, stage?): Promise<OpportunityWithParties[]>`
  — same signature, new return type.
- Modifies: `OpportunityService.listByCreator(db, organizationId, creatorId, stage?): Promise<OpportunityWithParties[]>`
  — same signature, new return type, no logic change (still a pure delegate).

- [ ] **Step 1: Write the failing repository test**

Read the current content of `src/repositories/opportunities.repository.test.ts` first — it
already has a `setup()` helper (creates org/creator/company/contact/lead) and a full working
test ("lists opportunities by creator, ordered by createdAt desc, with an optional stage
filter"). Extend that SAME test with the new assertions (do not write a second, separate
test) — add these lines right after the existing
`expect(list.some((row) => row.id === opportunity.id)).toBe(true);` assertion:

```typescript
// Party enrichment: the row must carry the company/contact names resolved
// via the lead, not raw UUIDs.
const enrichedRow = list.find((row) => row.id === opportunity.id)!;
expect(enrichedRow.companyName).toBe("Bella Cosméticos");
expect(enrichedRow.contactName).toBe("Maria");
expect(enrichedRow.brandName).toBeNull();
```

Then add this SEPARATE new test (LEFT JOIN safety — an opportunity with no company/brand must
still be returned, not silently dropped):

```typescript
it("still returns an opportunity with no company/brand (LEFT JOIN safety)", async () => {
  const { db, cleanup: c, org, creator, contact, lead: leadWithCompany } = await setup();
  cleanup = c;

  // A second lead/opportunity with companyId/brandId both null.
  const [contactOnly] = await db
    .insert(contacts)
    .values({ organizationId: org.id, fullName: "João" })
    .returning();
  const [leadNoCompany] = await db
    .insert(leads)
    .values({
      organizationId: org.id,
      creatorId: creator.id,
      contactId: contactOnly.id,
      companyId: null,
      qualified: false,
    })
    .returning();
  const opportunity = await OpportunitiesRepository.create(db, org.id, {
    creatorId: creator.id,
    leadId: leadNoCompany.id,
    companyId: null,
    brandId: null,
  });

  const list = await OpportunitiesRepository.listByCreator(db, org.id, creator.id);
  const row = list.find((r) => r.id === opportunity.id);
  expect(row).toBeDefined();
  expect(row!.companyName).toBeNull();
  expect(row!.brandName).toBeNull();
  expect(row!.contactName).toBe("João");
});
```

Check `setup()`'s current return shape — it returns `{ db, cleanup: c, org, creator, company,
lead }`, without `contact` exposed directly; add `contact` to its returned object (it already
inserts a `contact` row internally) so this new test can reuse it, OR insert a fresh
org/creator/contact pair inline in the new test if simpler — read the file first and use
whichever keeps the diff smallest.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/opportunities.repository.test.ts`
Expected: FAIL — `companyName`/`brandName`/`contactName` are all `undefined` on the returned
rows today.

- [ ] **Step 3: Implement the joins**

```typescript
// src/repositories/opportunities.repository.ts
// Add `companies`, `brands`, `contacts` to the schema imports at the top
// of the file (alongside the existing `leads` import from
// "@/db/schema/commercial-flow"):
import { companies, brands, contacts } from "@/db/schema/companies-brands-contacts";

// Add this type near the existing `Opportunity` type export:
export type OpportunityWithParties = Opportunity & {
  companyName: string | null;
  brandName: string | null;
  contactName: string;
};

// Replace the body of `listByCreator`:
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    stage?: Opportunity["stage"],
  ): Promise<OpportunityWithParties[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const conditions = [
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.creatorId, creatorId),
      ];
      if (stage) {
        conditions.push(eq(opportunities.stage, stage));
      }

      const rows = await tx
        .select({
          opportunity: opportunities,
          companyName: companies.name,
          brandName: brands.name,
          contactName: contacts.fullName,
        })
        .from(opportunities)
        .innerJoin(leads, eq(leads.id, opportunities.leadId))
        .innerJoin(contacts, eq(contacts.id, leads.contactId))
        .leftJoin(companies, eq(companies.id, opportunities.companyId))
        .leftJoin(brands, eq(brands.id, opportunities.brandId))
        .where(and(...conditions))
        .orderBy(desc(opportunities.createdAt));

      return rows.map((row) => ({
        ...row.opportunity,
        companyName: row.companyName ?? null,
        brandName: row.brandName ?? null,
        contactName: row.contactName,
      }));
    });
  },
```

Check the file's existing `import { and, desc, eq, or } from "drizzle-orm";` line — `and`,
`desc`, `eq` are already imported; no change needed there. The existing
`import { opportunities, opportunityStageHistory, leads } from "@/db/schema/commercial-flow";`
line already has `leads` — no change needed there either.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/opportunities.repository.test.ts`
Expected: PASS (all tests in the file, including the two new/extended cases)

- [ ] **Step 5: Update the service layer's return type**

```typescript
// src/services/opportunity.service.ts
// Add `OpportunityWithParties` to the existing import line from the repository:
import {
  OpportunitiesRepository,
  type Opportunity,
  type OpportunityWithParties,
} from "@/repositories/opportunities.repository";

// Update listByCreator's signature (body is unchanged — still a pure delegate):
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    stage?: Opportunity["stage"],
  ): Promise<OpportunityWithParties[]> {
    return OpportunitiesRepository.listByCreator(db, organizationId, creatorId, stage);
  },
```

- [ ] **Step 6: Write the failing route test assertion**

Read the current content of `src/app/api/opportunities/route.test.ts` first — it already
ingests a real opportunity via `OpportunityService.createFromLead` and asserts
`json.some((row) => row.id === opportunity.id)`. Add these lines right after that existing
assertion:

```typescript
    const enrichedRow = json.find((row: { id: string }) => row.id === opportunity.id);
    expect(enrichedRow.companyName).toBe("Bella Cosméticos");
    expect(enrichedRow.contactName).toBe("Maria");
    expect(enrichedRow.brandName).toBeNull();
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/opportunities/route.test.ts`
Expected: FAIL — before Steps 3/5's changes are in place; if you're implementing this plan in
order, Steps 3–5 are already done, so re-run to confirm this now passes instead (Step 8).

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/opportunities/route.test.ts`
Expected: PASS — no route code changes were needed; the route already forwards the service's
return value unmodified via `NextResponse.json(list, { status: 200 })`.

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/repositories/opportunities.repository.ts src/repositories/opportunities.repository.test.ts src/services/opportunity.service.ts src/app/api/opportunities/route.test.ts
git commit -m "feat: enrich GET /api/opportunities with company/brand/contact names"
```

---

## Self-Review

**Spec coverage:**
- Decisão #1 (join location) — Task 1, Step 3.
- Decisão #2 (exact 3 fields) — Task 1's `OpportunityWithParties` type and both test
  extensions assert all 3.
- Decisão #3 (join safety: LEFT for nullable, INNER for NOT NULL) — encoded directly in Step
  3's implementation and covered by the dedicated LEFT-JOIN-safety test in Step 1.
- Decisão #4 (service type update, no logic change) — Task 1, Step 5.
- Decisão #5 (no route change) — Task 1, Steps 6–8 confirm the route needs no edits.
- §3 "fora de escopo" (no detail-route enrichment, no PATCH change, no `displayName` field) —
  no task introduces any of these.

**Placeholder scan:** none — every step has literal code or an exact, runnable test command.

**Type consistency:** `OpportunityWithParties` is defined once (repository) and reused by
name (not redefined) in the service's return type. `listByCreator`'s parameter list
(`db, organizationId, creatorId, stage?`) is identical at both layers, matching the Global
Constraints.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-opportunities-party-enrichment.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
