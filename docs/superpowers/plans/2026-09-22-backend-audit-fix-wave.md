# Backend Audit Fix Wave (Pre-UI Hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two Critical gaps found by the cross-milestone integration audit —
missing `creatorId` ownership validation and the absent Milestone 2 read API surface — plus
two Important architectural cleanups (extracting domain logic out of
`ProposalVersionsRepository`, routing Proposals' GET endpoints through their service),
per `docs/superpowers/specs/2026-09-22-backend-audit-fix-wave-design.md`.

**Architecture:** Same layering as every prior plan: `db/schema` → `repositories` (via
`runInTenantContext`, `*WithTx` from the start) → `services` (domain rules) → `app/api`.
No new tables — this plan only adds repository/service methods and API routes on top of the
existing schema, plus one refactor (moving snapshot/version-number logic from repository to
service).

**Tech Stack:** Next.js 16 (Route Handlers), Drizzle ORM, PostgreSQL (RLS), Zod, Vitest.

## Global Constraints

- Any `creatorId` supplied by a caller MUST be validated as belonging to the request's
  `organizationId` before use — via `CreatorsRepository.existsForOrganization`/
  `existsForOrganizationWithTx`, never relying on the FK constraint alone (Postgres FK
  checks bypass RLS).
- All new list endpoints are ordered by `createdAt desc` for determinism — no pagination in
  this plan (none exists anywhere in the project yet; not introduced here).
- `Opportunity` stage changes write `opportunities.stage` and a new
  `opportunity_stage_history` row atomically, in the same transaction — no new stage-
  transition validation rules are introduced (none exist in the product spec).
- `Lead`/`Company`/`Contact` read endpoints route through a thin service layer
  (`LeadService`/`CompanyService`/`ContactService`), even though today they're simple
  wrappers — routes never call repositories directly, matching the fix being made to
  Proposals in this same plan.
- No `userId` requirement is added to any Milestone 2 endpoint in this plan — that
  inconsistency is a documented, deferred decision (see spec §5), not something to resolve
  here.
- No CRUD beyond list+detail (read) for Leads/Companies/Contacts — no create/update/delete
  routes for these in this plan.

---

## File Structure

```
src/
  domain/
    creators/
      errors.ts                          # NEW: CreatorNotFoundError
    commercial-flow/
      errors.ts                          # MODIFY: add OpportunityNotFoundError
  repositories/
    creators.repository.ts                # MODIFY: add existsForOrganization/WithTx
    services.repository.ts                # MODIFY: add createWithTx
    commercial-inquiries.repository.ts     # MODIFY: add listByCreator
    opportunities.repository.ts            # MODIFY: add listByCreator, updateStage/WithTx
    leads.repository.ts                    # MODIFY: add listByCreator
    companies.repository.ts                # MODIFY: add listByOrganization, findById
    contacts.repository.ts                 # MODIFY: add listByOrganization
    proposal-versions.repository.ts        # MODIFY: strip to persistence-only
  services/
    inbox.service.ts                       # MODIFY: validate creatorId
    service.service.ts                     # MODIFY: validate creatorId
    rate-card.service.ts                   # MODIFY: validate creatorId
    commercial-inquiry.service.ts          # MODIFY: add listByCreator
    opportunity.service.ts                 # MODIFY: add listByCreator, changeStage
    lead.service.ts                        # NEW
    company.service.ts                     # NEW
    contact.service.ts                     # NEW
    proposal-version.service.ts            # NEW: snapshot/version-number logic moves here
    proposal.service.ts                    # MODIFY: add listByOpportunity, update version call site
    proposal-item.service.ts               # MODIFY: update version call site
    proposal-block.service.ts              # MODIFY: update version call site
  app/
    api/
      commercial-inquiries/
        route.ts                           # NEW: GET
      opportunities/
        route.ts                           # NEW: GET
        [id]/route.ts                      # NEW: GET, PATCH
      leads/
        route.ts                           # NEW: GET
        [id]/route.ts                      # NEW: GET
      companies/
        route.ts                           # NEW: GET
        [id]/route.ts                      # NEW: GET
      contacts/
        route.ts                           # NEW: GET
        [id]/route.ts                      # NEW: GET
      proposals/
        route.ts                           # MODIFY: GET uses ProposalService
        [id]/versions/route.ts             # MODIFY: GET uses ProposalVersionService
```

---

### Task 1: `CreatorsRepository.existsForOrganization` + `CreatorNotFoundError`

**Files:**
- Create: `src/domain/creators/errors.ts`
- Modify: `src/repositories/creators.repository.ts`
- Test: `src/repositories/creators.repository.test.ts`

**Interfaces:**
- Produces: `CreatorNotFoundError` from `src/domain/creators/errors.ts` — shared by every
  module that validates a caller-supplied `creatorId` (Inbox, Services, Rate Cards).
- Produces: `CreatorsRepository.existsForOrganization(db, organizationId, creatorId): Promise<boolean>` and `.existsForOrganizationWithTx(tx, organizationId, creatorId): Promise<boolean>` from `src/repositories/creators.repository.ts` — mirrors `OrganizationMembersRepository.existsForOrganization`/`WithTx` exactly.

- [ ] **Step 1: Write the failing test**

```typescript
// append to src/repositories/creators.repository.test.ts
import { CreatorsRepository } from "./creators.repository";
// (existing imports already present)

it("confirms a creator belongs to an organization, and denies a creator from another organization or a nonexistent id", async () => {
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

  expect(await CreatorsRepository.existsForOrganization(db, orgA.id, creatorA.id)).toBe(true);
  expect(await CreatorsRepository.existsForOrganization(db, orgA.id, creatorB.id)).toBe(false);
  expect(
    await CreatorsRepository.existsForOrganization(db, orgA.id, "00000000-0000-0000-0000-000000000000"),
  ).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/creators.repository.test.ts`
Expected: FAIL — `existsForOrganization` doesn't exist.

- [ ] **Step 3: Implement the domain error**

```typescript
// src/domain/creators/errors.ts
// Thrown when a creatorId does not resolve to a row visible to the
// caller's organization — either it doesn't exist at all, or it belongs
// to another organization. Postgres FK constraints bypass RLS, so without
// an explicit check, a caller could pass a foreign org's creatorId and
// have the FK happily accept it (e.g. InboxService.ingestManualMessage,
// ServiceService.create, RateCardService.create all accept a
// caller-supplied creatorId with no prior organization membership).
export class CreatorNotFoundError extends Error {
  constructor(creatorId: string) {
    super(`Creator ${creatorId} not found`);
    this.name = "CreatorNotFoundError";
  }
}
```

- [ ] **Step 4: Implement the repository methods**

```typescript
// src/repositories/creators.repository.ts
// Add this private helper alongside insertCreator, and the two public
// methods inside the exported CreatorsRepository object.
import { eq, and } from "drizzle-orm"; // merge `and` into the existing `eq` import if present

async function selectCreatorExists(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  creatorId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: creators.id })
    .from(creators)
    .where(and(eq(creators.id, creatorId), eq(creators.organizationId, organizationId)));
  return Boolean(row);
}

// add inside the exported CreatorsRepository object:
  async existsForOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<boolean> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectCreatorExists(tx, organizationId, creatorId),
    );
  },

  async existsForOrganizationWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<boolean> {
    return selectCreatorExists(tx, organizationId, creatorId);
  },
```

Check the file's current imports before adding `and` — it may already import `eq` alone.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/creators.repository.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/domain/creators src/repositories/creators.repository.ts src/repositories/creators.repository.test.ts
git commit -m "feat: add CreatorsRepository.existsForOrganization and CreatorNotFoundError"
```

---

### Task 2: Validate `creatorId` in `InboxService.ingestManualMessage`

**Files:**
- Modify: `src/services/inbox.service.ts`
- Test: `src/services/inbox.service.test.ts`

**Interfaces:**
- Consumes: `CreatorsRepository.existsForOrganizationWithTx` (Task 1), `CreatorNotFoundError` (Task 1).
- `InboxService.ingestManualMessage`'s signature is unchanged — the validation is added
  inside its existing transaction, before any write.

- [ ] **Step 1: Write the failing test**

```typescript
// append to src/services/inbox.service.test.ts
import { CreatorNotFoundError } from "@/domain/creators/errors";
// (existing imports already present)

it("rejects ingestion when creatorId belongs to another organization", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const { organization } = await OrganizationService.createWithOwner(db, {
    organizationName: "Org",
    ownerEmail: `owner-${Date.now()}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const { organization: otherOrganization } = await OrganizationService.createWithOwner(db, {
    organizationName: "Other Org",
    ownerEmail: `owner2-${Date.now()}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const foreignCreator = await CreatorService.onboardCreator(db, otherOrganization.id, {
    email: `foreign-${Date.now()}@publyflow.test`,
    fullName: "Foreign Creator",
    displayName: "Foreign Creator",
  });

  const ai = { classifyMessage: async () => ({
    category: "FAN" as const,
    commercialScore: 1,
    intent: null,
    extracted: {
      companyName: null,
      brandName: null,
      contactName: null,
      email: null,
      phone: null,
      budget: null,
      deliverables: null,
    },
  }) };

  await expect(
    InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: foreignCreator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Someone",
      body: "Oi!",
      receivedAt: new Date(),
    }),
  ).rejects.toThrow(CreatorNotFoundError);
});
```

Check the existing test file's imports for `OrganizationService`/`CreatorService` — they're
likely already imported for other tests in this file; reuse rather than re-importing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/inbox.service.test.ts`
Expected: FAIL — no error thrown, message ingests successfully with a foreign creatorId.

- [ ] **Step 3: Add the validation**

```typescript
// src/services/inbox.service.ts
// Add these imports:
import { CreatorsRepository } from "@/repositories/creators.repository";
import { CreatorNotFoundError } from "@/domain/creators/errors";

// Inside the runInTenantContext(...) callback, as the FIRST statement
// (before ConversationsRepository.createWithTx):
      const creatorExists = await CreatorsRepository.existsForOrganizationWithTx(
        tx,
        organizationId,
        input.creatorId,
      );
      if (!creatorExists) {
        throw new CreatorNotFoundError(input.creatorId);
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/inbox.service.test.ts`
Expected: PASS. Also re-run the full file to confirm the existing "creates a Commercial
Inquiry"/"does not create..." tests still pass unchanged (they use a real, same-org
creator, so the new check should not affect them).

- [ ] **Step 5: Run the full suite, then commit**

```bash
pnpm test
git add src/services/inbox.service.ts src/services/inbox.service.test.ts
git commit -m "feat: validate creatorId ownership in InboxService.ingestManualMessage"
```

---

### Task 3: Validate `creatorId` in `ServiceService.create`

**Files:**
- Modify: `src/repositories/services.repository.ts` (add `createWithTx`)
- Modify: `src/services/service.service.ts`
- Test: `src/repositories/services.repository.test.ts`
- Test: `src/services/service.service.test.ts`

**Interfaces:**
- Produces: `ServicesRepository.createWithTx(tx, organizationId, input): Promise<Service>` — didn't exist before this task; `create` is refactored to share logic with it via a private helper, mirroring every other repository in this codebase.
- Consumes: `CreatorsRepository.existsForOrganizationWithTx` (Task 1), `CreatorNotFoundError` (Task 1).

- [ ] **Step 1: Write the failing repository test**

```typescript
// append to src/repositories/services.repository.test.ts
it("createWithTx inserts a service inside a caller-supplied transaction", async () => {
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

  const service = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org_id', ${org.id}, true)`);
    return ServicesRepository.createWithTx(tx, org.id, { creatorId: creator.id, name: "01 Reel" });
  });

  expect(service.name).toBe("01 Reel");
});
```

Add `import { sql } from "drizzle-orm";` if not already present in this test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/services.repository.test.ts`
Expected: FAIL — `createWithTx` doesn't exist.

- [ ] **Step 3: Refactor the repository**

```typescript
// src/repositories/services.repository.ts
// Extract a private helper and add createWithTx, following the exact
// pattern already used for findById/findByIdWithTx in this same file.

async function insertService(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateServiceInput,
): Promise<Service> {
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
}

// Replace the existing `create` method body with:
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateServiceInput,
  ): Promise<Service> {
    return runInTenantContext(db, organizationId, (tx) => insertService(tx, organizationId, input));
  },

// Add immediately after:
  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateServiceInput,
  ): Promise<Service> {
    return insertService(tx, organizationId, input);
  },
```

- [ ] **Step 4: Run the repository test to verify it passes**

Run: `pnpm vitest run src/repositories/services.repository.test.ts`
Expected: PASS (including the pre-existing test, confirming the refactor didn't change
`create`'s behavior).

- [ ] **Step 5: Write the failing service test**

```typescript
// append to src/services/service.service.test.ts
import { CreatorNotFoundError } from "@/domain/creators/errors";
// (existing imports already present)

it("rejects creating a service when creatorId belongs to another organization", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const { organization } = await OrganizationService.createWithOwner(db, {
    organizationName: "Org",
    ownerEmail: `owner-${Date.now()}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const { organization: otherOrganization } = await OrganizationService.createWithOwner(db, {
    organizationName: "Other Org",
    ownerEmail: `owner2-${Date.now()}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const foreignCreator = await CreatorService.onboardCreator(db, otherOrganization.id, {
    email: `foreign-${Date.now()}@publyflow.test`,
    fullName: "Foreign Creator",
    displayName: "Foreign Creator",
  });

  await expect(
    ServiceService.create(db, organization.id, { creatorId: foreignCreator.id, name: "01 Reel" }),
  ).rejects.toThrow(CreatorNotFoundError);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/services/service.service.test.ts`
Expected: FAIL — service is created successfully with a foreign creatorId.

- [ ] **Step 7: Add the validation to `ServiceService.create`**

```typescript
// src/services/service.service.ts
// Add these imports:
import { runInTenantContext } from "@/repositories/tenant-context";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { CreatorNotFoundError } from "@/domain/creators/errors";

// Replace ServiceService.create's body:
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateServiceInput,
  ): Promise<Service> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const creatorExists = await CreatorsRepository.existsForOrganizationWithTx(
        tx,
        organizationId,
        input.creatorId,
      );
      if (!creatorExists) {
        throw new CreatorNotFoundError(input.creatorId);
      }
      return ServicesRepository.createWithTx(tx, organizationId, input);
    });
  },
```

- [ ] **Step 8: Run the service test to verify it passes**

Run: `pnpm vitest run src/services/service.service.test.ts`
Expected: PASS (including the pre-existing "creates, updates, and deactivates" test).

- [ ] **Step 9: Run the full suite, then commit**

```bash
pnpm test
git add src/repositories/services.repository.ts src/repositories/services.repository.test.ts src/services/service.service.ts src/services/service.service.test.ts
git commit -m "feat: validate creatorId ownership in ServiceService.create"
```

---

### Task 4: Validate `creatorId` in `RateCardService.create`

**Files:**
- Modify: `src/services/rate-card.service.ts`
- Test: `src/services/rate-card.service.test.ts`

**Interfaces:**
- Consumes: `CreatorsRepository.existsForOrganizationWithTx` (Task 1), `CreatorNotFoundError` (Task 1), `RateCardsRepository.createWithTx` (already exists from the prior Rate Cards plan).
- `RateCardService.create`'s signature is unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
// append to src/services/rate-card.service.test.ts
import { CreatorNotFoundError } from "@/domain/creators/errors";
// (existing imports already present)

it("rejects creating a rate card when creatorId belongs to another organization", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const { organization } = await OrganizationService.createWithOwner(db, {
    organizationName: "Org",
    ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const { organization: otherOrganization } = await OrganizationService.createWithOwner(db, {
    organizationName: "Other Org",
    ownerEmail: `owner2-${Date.now()}-${Math.random()}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const foreignCreator = await CreatorService.onboardCreator(db, otherOrganization.id, {
    email: `foreign-${Date.now()}-${Math.random()}@publyflow.test`,
    fullName: "Foreign Creator",
    displayName: "Foreign Creator",
  });

  await expect(
    RateCardService.create(db, organization.id, { creatorId: foreignCreator.id, name: "Tabela" }),
  ).rejects.toThrow(CreatorNotFoundError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/rate-card.service.test.ts`
Expected: FAIL — rate card is created successfully with a foreign creatorId.

- [ ] **Step 3: Add the validation to `RateCardService.create`**

```typescript
// src/services/rate-card.service.ts
// Add these imports:
import { CreatorsRepository } from "@/repositories/creators.repository";
import { CreatorNotFoundError } from "@/domain/creators/errors";

// Replace RateCardService.create's body:
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardInput,
  ): Promise<RateCard> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const creatorExists = await CreatorsRepository.existsForOrganizationWithTx(
        tx,
        organizationId,
        input.creatorId,
      );
      if (!creatorExists) {
        throw new CreatorNotFoundError(input.creatorId);
      }
      return RateCardsRepository.createWithTx(tx, organizationId, input);
    });
  },
```

`runInTenantContext` is already imported in this file (used by `duplicate`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/rate-card.service.test.ts`
Expected: PASS (including the pre-existing "creates and lists"/"locks"/"duplicates" tests).

- [ ] **Step 5: Run the full suite, then commit**

```bash
pnpm test
git add src/services/rate-card.service.ts src/services/rate-card.service.test.ts
git commit -m "feat: validate creatorId ownership in RateCardService.create"
```

---

### Task 5: Commercial Inquiries — list API

**Files:**
- Modify: `src/repositories/commercial-inquiries.repository.ts` (add `listByCreator`)
- Modify: `src/services/commercial-inquiry.service.ts` (add `listByCreator`)
- Create: `src/app/api/commercial-inquiries/route.ts` (GET)
- Test: `src/repositories/commercial-inquiries.repository.test.ts`
- Test: `src/app/api/commercial-inquiries/route.test.ts`

**Interfaces:**
- Produces: `CommercialInquiriesRepository.listByCreator(db, organizationId, creatorId, status?): Promise<CommercialInquiry[]>` — ordered by `createdAt desc`, optional `status` filter (`commercialInquiryStatusEnum`: `NEW|DISCARDED|FALSE_POSITIVE|CONVERTED`).
- Produces: `CommercialInquiryService.listByCreator(db, organizationId, creatorId, status?): Promise<CommercialInquiry[]>` — thin wrapper.
- Produces: `GET /api/commercial-inquiries?organizationId=&creatorId=&status=` (status optional), `200` with `CommercialInquiry[]`.

- [ ] **Step 1: Write the failing repository test**

```typescript
// append to src/repositories/commercial-inquiries.repository.test.ts
// (check the file's existing setup helper for org/creator/message fixtures — reuse it)

it("lists inquiries by creator, ordered by createdAt desc, with an optional status filter", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const { organization, creator, message: message1 } = await setup(db); // adapt to this file's actual setup helper name/shape
  const [inquiry1] = await db
    .insert(commercialInquiries)
    .values({ organizationId: organization.id, creatorId: creator.id, messageId: message1.id, status: "NEW" })
    .returning();

  // create a second message + inquiry for the same creator with a different status
  // (follow this file's existing pattern for inserting a second message fixture)

  const list = await CommercialInquiriesRepository.listByCreator(db, organization.id, creator.id);
  expect(list.length).toBeGreaterThanOrEqual(1);

  const newOnly = await CommercialInquiriesRepository.listByCreator(db, organization.id, creator.id, "NEW");
  expect(newOnly.every((row) => row.status === "NEW")).toBe(true);
});
```

Note: adapt this test to whatever setup helper `commercial-inquiries.repository.test.ts`
already uses for creating an org+creator+message fixture — read the file first and reuse
its exact helper rather than duplicating fixture-creation code. The core assertions (list
returns inquiries for the creator; status filter narrows correctly) are what matters.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/commercial-inquiries.repository.test.ts`
Expected: FAIL — `listByCreator` doesn't exist.

- [ ] **Step 3: Implement the repository method**

```typescript
// src/repositories/commercial-inquiries.repository.ts
// Add `desc` to the existing drizzle-orm import line.

// Add inside the exported CommercialInquiriesRepository object:
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    status?: CommercialInquiry["status"],
  ): Promise<CommercialInquiry[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const conditions = [
        eq(commercialInquiries.organizationId, organizationId),
        eq(commercialInquiries.creatorId, creatorId),
      ];
      if (status) {
        conditions.push(eq(commercialInquiries.status, status));
      }
      return tx
        .select()
        .from(commercialInquiries)
        .where(and(...conditions))
        .orderBy(desc(commercialInquiries.createdAt));
    });
  },
```

- [ ] **Step 4: Run the repository test to verify it passes**

Run: `pnpm vitest run src/repositories/commercial-inquiries.repository.test.ts`
Expected: PASS

- [ ] **Step 5: Add the service wrapper**

```typescript
// src/services/commercial-inquiry.service.ts
// Add inside the exported CommercialInquiryService object:
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    status?: CommercialInquiry["status"],
  ): Promise<CommercialInquiry[]> {
    return CommercialInquiriesRepository.listByCreator(db, organizationId, creatorId, status);
  },
```

Check the file's current imports — `CommercialInquiry` type may need importing from the
repository module alongside `CommercialInquiriesRepository`.

- [ ] **Step 6: Write the failing route test**

```typescript
// src/app/api/commercial-inquiries/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { InboxService } from "@/services/inbox.service";

describe("GET /api/commercial-inquiries", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the creator's inquiries", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));
    vi.doMock("@/lib/ai", () => ({
      ai: {
        classifyMessage: async () => ({
          category: "COMMERCIAL_LEAD",
          commercialScore: 90,
          intent: "Pedido de mídia kit",
          extracted: {
            companyName: "Bella Cosméticos",
            brandName: null,
            contactName: "Maria",
            email: null,
            phone: null,
            budget: null,
            deliverables: null,
          },
        }),
      },
    }));

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

    const { ai } = await import("@/lib/ai");
    await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores.",
      receivedAt: new Date(),
    });

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/commercial-inquiries?organizationId=${organization.id}&creatorId=${creator.id}`,
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.length).toBe(1);
    expect(json[0].companyGuess).toBe("Bella Cosméticos");
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/commercial-inquiries/route.test.ts`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 8: Implement the route**

```typescript
// src/app/api/commercial-inquiries/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";

const statusEnum = z.enum(["NEW", "DISCARDED", "FALSE_POSITIVE", "CONVERTED"]);

const querySchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
  status: statusEnum.optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = querySchema.parse({
    organizationId: url.searchParams.get("organizationId"),
    creatorId: url.searchParams.get("creatorId"),
    status: url.searchParams.get("status") ?? undefined,
  });
  const list = await CommercialInquiryService.listByCreator(
    db,
    payload.organizationId,
    payload.creatorId,
    payload.status,
  );
  return NextResponse.json(list, { status: 200 });
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/commercial-inquiries/route.test.ts`
Expected: PASS

- [ ] **Step 10: Verify the app builds, run the full suite, then commit**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test pnpm build
pnpm test
git add src/repositories/commercial-inquiries.repository.ts src/repositories/commercial-inquiries.repository.test.ts src/services/commercial-inquiry.service.ts src/app/api/commercial-inquiries
git commit -m "feat: add Commercial Inquiries list API"
```

---

### Task 6: Opportunities — list + detail API

**Files:**
- Modify: `src/repositories/opportunities.repository.ts` (add `listByCreator`)
- Modify: `src/services/opportunity.service.ts` (add `listByCreator`)
- Create: `src/app/api/opportunities/route.ts` (GET)
- Create: `src/app/api/opportunities/[id]/route.ts` (GET — PATCH added in Task 7)
- Test: `src/repositories/opportunities.repository.test.ts`
- Test: `src/app/api/opportunities/route.test.ts`

**Interfaces:**
- Produces: `OpportunitiesRepository.listByCreator(db, organizationId, creatorId, stage?): Promise<Opportunity[]>` — ordered by `createdAt desc`, optional `stage` filter (`opportunityStageEnum`).
- Produces: `OpportunityService.listByCreator(db, organizationId, creatorId, stage?): Promise<Opportunity[]>`.
- Produces: `GET /api/opportunities?organizationId=&creatorId=&stage=`, `200`. `GET /api/opportunities/:id?organizationId=`, `200` with the `Opportunity`, `404` if not found (using `OpportunityNotFoundError` — added in this task since Task 7 also needs it).

- [ ] **Step 1: Add `OpportunityNotFoundError`**

```typescript
// src/domain/commercial-flow/errors.ts
// Add at the end of the file:

// Thrown when an opportunityId does not resolve to a row visible to the
// caller's organization — used by the detail route and by
// OpportunityService.changeStage (Task 7).
export class OpportunityNotFoundError extends Error {
  constructor(opportunityId: string) {
    super(`Opportunity ${opportunityId} not found`);
    this.name = "OpportunityNotFoundError";
  }
}
```

- [ ] **Step 2: Write the failing repository test**

```typescript
// append to src/repositories/opportunities.repository.test.ts
// (read the file first for its existing setup helper — reuse it to create
// org/creator/contact/lead fixtures)

it("lists opportunities by creator, ordered by createdAt desc, with an optional stage filter", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  // use this file's existing setup to get { organization, creator, lead }
  const opportunity = await OpportunitiesRepository.create(db, organization.id, {
    creatorId: creator.id,
    leadId: lead.id,
    companyId: null,
    brandId: null,
  });

  const list = await OpportunitiesRepository.listByCreator(db, organization.id, creator.id);
  expect(list.some((row) => row.id === opportunity.id)).toBe(true);

  const filtered = await OpportunitiesRepository.listByCreator(
    db,
    organization.id,
    creator.id,
    "NOVO_LEAD",
  );
  expect(filtered.every((row) => row.stage === "NOVO_LEAD")).toBe(true);
});
```

Adapt the setup portion to this file's actual existing fixture-creation helper (read the
file first — it already has org/creator/contact/lead creation for its other tests, likely
requiring a `brandId`/`companyId` per the party-validation rule from `OpportunityService`).
The important part is that `OpportunitiesRepository.create` needs `companyId` or `brandId`
set (per the existing `InvalidOpportunityPartyError` rule) — use `OpportunityService.createFromLead`
instead of the raw repository `create` if that's what the existing test fixtures already do,
to satisfy that validation without re-deriving it here.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/opportunities.repository.test.ts`
Expected: FAIL — `listByCreator` doesn't exist.

- [ ] **Step 4: Implement the repository method**

```typescript
// src/repositories/opportunities.repository.ts
// `and`, `desc`, `eq` are already imported in this file.

// Add inside the exported OpportunitiesRepository object:
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    stage?: Opportunity["stage"],
  ): Promise<Opportunity[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const conditions = [
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.creatorId, creatorId),
      ];
      if (stage) {
        conditions.push(eq(opportunities.stage, stage));
      }
      return tx
        .select()
        .from(opportunities)
        .where(and(...conditions))
        .orderBy(desc(opportunities.createdAt));
    });
  },
```

- [ ] **Step 5: Run the repository test to verify it passes**

Run: `pnpm vitest run src/repositories/opportunities.repository.test.ts`
Expected: PASS

- [ ] **Step 6: Add the service wrapper**

```typescript
// src/services/opportunity.service.ts
// Add inside the exported OpportunityService object:
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    stage?: Opportunity["stage"],
  ): Promise<Opportunity[]> {
    return OpportunitiesRepository.listByCreator(db, organizationId, creatorId, stage);
  },
```

- [ ] **Step 7: Write the failing route test**

```typescript
// src/app/api/opportunities/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { OpportunityService } from "@/services/opportunity.service";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, companies } from "@/db/schema/commercial-flow";
import { companies as companiesTable } from "@/db/schema/companies-brands-contacts";

describe("GET /api/opportunities", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the creator's opportunities", async () => {
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
    const [company] = await db
      .insert(companiesTable)
      .values({ organizationId: organization.id, name: "Bella Cosméticos" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({
        organizationId: organization.id,
        creatorId: creator.id,
        contactId: contact.id,
        companyId: company.id,
        qualified: true,
      })
      .returning();
    const opportunity = await OpportunityService.createFromLead(db, organization.id, {
      leadId: lead.id,
      creatorId: creator.id,
      companyId: company.id,
      brandId: null,
    });

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/opportunities?organizationId=${organization.id}&creatorId=${creator.id}`,
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === opportunity.id)).toBe(true);
  });
});
```

Fix the duplicate `companies` import above before running — import `companies` only once
from `@/db/schema/companies-brands-contacts` (drop the unused import from
`@/db/schema/commercial-flow`, which doesn't export a `companies` table).

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/opportunities/route.test.ts`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 9: Implement the list route**

```typescript
// src/app/api/opportunities/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { OpportunityService } from "@/services/opportunity.service";

const stageEnum = z.enum([
  "NOVO_LEAD",
  "QUALIFICACAO",
  "PRIMEIRO_CONTATO",
  "MIDIA_KIT_ENVIADO",
  "PROPOSTA_SOLICITADA",
  "PROPOSTA_ENVIADA",
  "NEGOCIACAO",
  "AGUARDANDO_CLIENTE",
  "FECHADO",
  "PERDIDO",
]);

const querySchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
  stage: stageEnum.optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = querySchema.parse({
    organizationId: url.searchParams.get("organizationId"),
    creatorId: url.searchParams.get("creatorId"),
    stage: url.searchParams.get("stage") ?? undefined,
  });
  const list = await OpportunityService.listByCreator(
    db,
    payload.organizationId,
    payload.creatorId,
    payload.stage,
  );
  return NextResponse.json(list, { status: 200 });
}
```

- [ ] **Step 10: Implement the detail route**

```typescript
// src/app/api/opportunities/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { OpportunityNotFoundError } from "@/domain/commercial-flow/errors";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const opportunity = await OpportunitiesRepository.findById(db, payload.organizationId, id);
  if (!opportunity) {
    return NextResponse.json(
      { error: new OpportunityNotFoundError(id).message },
      { status: 404 },
    );
  }
  return NextResponse.json(opportunity, { status: 200 });
}
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `pnpm vitest run src/app/api/opportunities/route.test.ts`
Expected: PASS

- [ ] **Step 12: Verify the app builds, run the full suite, then commit**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test pnpm build
pnpm test
git add src/domain/commercial-flow/errors.ts src/repositories/opportunities.repository.ts src/repositories/opportunities.repository.test.ts src/services/opportunity.service.ts src/app/api/opportunities
git commit -m "feat: add Opportunities list and detail API"
```

---

### Task 7: Opportunities — stage change API + `opportunity_stage_history`

**Files:**
- Modify: `src/repositories/opportunities.repository.ts` (add `updateStage`/`updateStageWithTx`)
- Modify: `src/services/opportunity.service.ts` (add `changeStage`)
- Modify: `src/app/api/opportunities/[id]/route.ts` (add PATCH)
- Test: `src/repositories/opportunities.repository.test.ts`
- Test: `src/app/api/opportunities/[id]/route.test.ts`

**Interfaces:**
- Produces: `OpportunitiesRepository.updateStage(db, organizationId, opportunityId, newStage): Promise<Opportunity>` and `.updateStageWithTx(tx, organizationId, opportunityId, newStage): Promise<Opportunity>` — both update `opportunities.stage` AND insert an `opportunity_stage_history` row (`fromStage` = the row's stage before the update, `toStage` = `newStage`) atomically, mirroring how `insertOpportunity` already writes both the opportunity and its initial history row together. Throws `OpportunityNotFoundError` if the id doesn't resolve.
- Produces: `OpportunityService.changeStage(db, organizationId, opportunityId, newStage): Promise<Opportunity>` — thin wrapper.
- Produces: `PATCH /api/opportunities/:id` accepting `{organizationId, stage}`, `200` with the updated `Opportunity`, `404` if not found.

- [ ] **Step 1: Write the failing repository test**

```typescript
// append to src/repositories/opportunities.repository.test.ts
import { opportunityStageHistory } from "@/db/schema/commercial-flow";
import { eq } from "drizzle-orm";
// (merge into existing imports)

it("updateStage changes the opportunity's stage and records a stage_history row in one transaction", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  // reuse this file's existing setup to get { organization, creator, lead }
  // via OpportunityService.createFromLead (companyId or brandId required)
  const opportunity = await OpportunityService.createFromLead(db, organization.id, {
    leadId: lead.id,
    creatorId: creator.id,
    companyId: company.id,
    brandId: null,
  });

  const updated = await OpportunitiesRepository.updateStage(
    db,
    organization.id,
    opportunity.id,
    "PRIMEIRO_CONTATO",
  );
  expect(updated.stage).toBe("PRIMEIRO_CONTATO");

  const history = await db
    .select()
    .from(opportunityStageHistory)
    .where(eq(opportunityStageHistory.opportunityId, opportunity.id));

  expect(history).toHaveLength(2); // initial NOVO_LEAD entry (from create) + this transition
  const transition = history.find((row) => row.toStage === "PRIMEIRO_CONTATO");
  expect(transition?.fromStage).toBe("NOVO_LEAD");
});

it("throws OpportunityNotFoundError when updating the stage of a nonexistent opportunity", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const [org] = await db.insert(organizations).values({ name: "Org" }).returning();

  await expect(
    OpportunitiesRepository.updateStage(
      db,
      org.id,
      "00000000-0000-0000-0000-000000000000",
      "PRIMEIRO_CONTATO",
    ),
  ).rejects.toThrow(OpportunityNotFoundError);
});
```

Import `OpportunityNotFoundError` from `@/domain/commercial-flow/errors` and
`OpportunityService` from `@/services/opportunity.service` if not already imported in this
test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/opportunities.repository.test.ts`
Expected: FAIL — `updateStage` doesn't exist.

- [ ] **Step 3: Implement the repository method**

```typescript
// src/repositories/opportunities.repository.ts
// Add this private helper (mirrors insertOpportunity's two-write shape):
import { OpportunityNotFoundError } from "@/domain/commercial-flow/errors";

async function updateOpportunityStage(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  opportunityId: string,
  newStage: Opportunity["stage"],
): Promise<Opportunity> {
  const current = await selectOpportunityById(tx, organizationId, opportunityId);
  if (!current) {
    throw new OpportunityNotFoundError(opportunityId);
  }

  const [updated] = await tx
    .update(opportunities)
    .set({ stage: newStage })
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .returning();

  await tx.insert(opportunityStageHistory).values({
    organizationId,
    opportunityId,
    fromStage: current.stage,
    toStage: newStage,
  });

  return updated;
}

// Add inside the exported OpportunitiesRepository object:
  async updateStage(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
    newStage: Opportunity["stage"],
  ): Promise<Opportunity> {
    return runInTenantContext(db, organizationId, (tx) =>
      updateOpportunityStage(tx, organizationId, opportunityId, newStage),
    );
  },

  async updateStageWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
    newStage: Opportunity["stage"],
  ): Promise<Opportunity> {
    return updateOpportunityStage(tx, organizationId, opportunityId, newStage);
  },
```

- [ ] **Step 4: Run the repository test to verify it passes**

Run: `pnpm vitest run src/repositories/opportunities.repository.test.ts`
Expected: PASS (both new tests)

- [ ] **Step 5: Add the service wrapper**

```typescript
// src/services/opportunity.service.ts
// Add inside the exported OpportunityService object:
  async changeStage(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
    newStage: Opportunity["stage"],
  ): Promise<Opportunity> {
    return OpportunitiesRepository.updateStage(db, organizationId, opportunityId, newStage);
  },
```

- [ ] **Step 6: Write the failing route test**

```typescript
// src/app/api/opportunities/[id]/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { OpportunityService } from "@/services/opportunity.service";
import { companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads } from "@/db/schema/commercial-flow";

describe("PATCH /api/opportunities/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the updated opportunity and records stage history", async () => {
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
    const [company] = await db
      .insert(companies)
      .values({ organizationId: organization.id, name: "Bella Cosméticos" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({
        organizationId: organization.id,
        creatorId: creator.id,
        contactId: contact.id,
        companyId: company.id,
        qualified: true,
      })
      .returning();
    const opportunity = await OpportunityService.createFromLead(db, organization.id, {
      leadId: lead.id,
      creatorId: creator.id,
      companyId: company.id,
      brandId: null,
    });

    const { PATCH } = await import("./route");

    const request = new Request(`http://localhost/api/opportunities/${opportunity.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: organization.id, stage: "PRIMEIRO_CONTATO" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: opportunity.id }) });
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.stage).toBe("PRIMEIRO_CONTATO");
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run "src/app/api/opportunities/[id]/route.test.ts"`
Expected: FAIL — `PATCH` isn't exported from `./route`.

- [ ] **Step 8: Add the PATCH handler**

```typescript
// src/app/api/opportunities/[id]/route.ts
// Add these imports at the top, alongside the existing ones:
import { z } from "zod"; // already imported for GET's querySchema — reuse
import { OpportunityService } from "@/services/opportunity.service";

const stageEnum = z.enum([
  "NOVO_LEAD",
  "QUALIFICACAO",
  "PRIMEIRO_CONTATO",
  "MIDIA_KIT_ENVIADO",
  "PROPOSTA_SOLICITADA",
  "PROPOSTA_ENVIADA",
  "NEGOCIACAO",
  "AGUARDANDO_CLIENTE",
  "FECHADO",
  "PERDIDO",
]);

const patchSchema = z.object({
  organizationId: z.string().uuid(),
  stage: stageEnum,
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = patchSchema.parse(await request.json());

  try {
    const opportunity = await OpportunityService.changeStage(db, payload.organizationId, id, payload.stage);
    return NextResponse.json(opportunity, { status: 200 });
  } catch (error) {
    if (error instanceof OpportunityNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
```

`NextResponse`, `db`, and `OpportunityNotFoundError` are already imported in this file from
Task 6's GET handler — do not duplicate those imports.

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm vitest run "src/app/api/opportunities/[id]/route.test.ts"`
Expected: PASS

- [ ] **Step 10: Verify the app builds, run the full suite, then commit**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test pnpm build
pnpm test
git add src/repositories/opportunities.repository.ts src/repositories/opportunities.repository.test.ts src/services/opportunity.service.ts src/app/api/opportunities
git commit -m "feat: add Opportunity stage-change API with atomic stage history"
```

---

### Task 8: Leads — list + detail API

**Files:**
- Modify: `src/repositories/leads.repository.ts` (add `listByCreator`)
- Create: `src/services/lead.service.ts`
- Create: `src/app/api/leads/route.ts` (GET)
- Create: `src/app/api/leads/[id]/route.ts` (GET)
- Test: `src/repositories/leads.repository.test.ts`
- Test: `src/app/api/leads/route.test.ts`

**Interfaces:**
- Produces: `LeadsRepository.listByCreator(db, organizationId, creatorId): Promise<Lead[]>` — ordered by `createdAt desc`.
- Produces: `LeadService.listByCreator(db, organizationId, creatorId): Promise<Lead[]>` and `.findById(db, organizationId, leadId): Promise<Lead | null>` from `src/services/lead.service.ts` — thin wrappers, following the same "route never calls repository directly" rule this whole plan is enforcing.
- Produces: `GET /api/leads?organizationId=&creatorId=`, `200`. `GET /api/leads/:id?organizationId=`, `200` or `404`.

- [ ] **Step 1: Write the failing repository test**

```typescript
// append to src/repositories/leads.repository.test.ts (check the file first for its
// existing setup helper — reuse it for org/creator/contact fixtures)

it("lists leads by creator, ordered by createdAt desc", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  // use this file's existing setup pattern to get { organization, creator, contact }
  const lead = await LeadsRepository.create(db, organization.id, {
    creatorId: creator.id,
    inquiryId: null,
    contactId: contact.id,
    companyId: null,
    brandId: null,
    qualified: true,
  });

  const list = await LeadsRepository.listByCreator(db, organization.id, creator.id);
  expect(list.some((row) => row.id === lead.id)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/leads.repository.test.ts`
Expected: FAIL — `listByCreator` doesn't exist.

- [ ] **Step 3: Implement the repository method**

```typescript
// src/repositories/leads.repository.ts
// Add `desc` to the existing drizzle-orm import line.

// Add inside the exported LeadsRepository object:
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<Lead[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(leads)
        .where(and(eq(leads.organizationId, organizationId), eq(leads.creatorId, creatorId)))
        .orderBy(desc(leads.createdAt));
    });
  },
```

- [ ] **Step 4: Run the repository test to verify it passes**

Run: `pnpm vitest run src/repositories/leads.repository.test.ts`
Expected: PASS

- [ ] **Step 5: Implement `LeadService`**

```typescript
// src/services/lead.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { LeadsRepository, type Lead } from "@/repositories/leads.repository";

export const LeadService = {
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<Lead[]> {
    return LeadsRepository.listByCreator(db, organizationId, creatorId);
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    leadId: string,
  ): Promise<Lead | null> {
    return LeadsRepository.findById(db, organizationId, leadId);
  },
};
```

- [ ] **Step 6: Write the failing route test**

```typescript
// src/app/api/leads/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { LeadsRepository } from "@/repositories/leads.repository";
import { contacts } from "@/db/schema/companies-brands-contacts";

describe("GET /api/leads", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the creator's leads", async () => {
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
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, fullName: "Maria" })
      .returning();
    const lead = await LeadsRepository.create(db, organization.id, {
      creatorId: creator.id,
      inquiryId: null,
      contactId: contact.id,
      companyId: null,
      brandId: null,
      qualified: true,
    });

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/leads?organizationId=${organization.id}&creatorId=${creator.id}`,
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === lead.id)).toBe(true);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/leads/route.test.ts`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 8: Implement the routes**

```typescript
// src/app/api/leads/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { LeadService } from "@/services/lead.service";

const querySchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = querySchema.parse({
    organizationId: url.searchParams.get("organizationId"),
    creatorId: url.searchParams.get("creatorId"),
  });
  const list = await LeadService.listByCreator(db, payload.organizationId, payload.creatorId);
  return NextResponse.json(list, { status: 200 });
}
```

```typescript
// src/app/api/leads/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { LeadService } from "@/services/lead.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const lead = await LeadService.findById(db, payload.organizationId, id);
  if (!lead) {
    return NextResponse.json({ error: `Lead ${id} not found` }, { status: 404 });
  }
  return NextResponse.json(lead, { status: 200 });
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/leads/route.test.ts`
Expected: PASS

- [ ] **Step 10: Verify the app builds, run the full suite, then commit**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test pnpm build
pnpm test
git add src/repositories/leads.repository.ts src/repositories/leads.repository.test.ts src/services/lead.service.ts src/app/api/leads
git commit -m "feat: add Leads list and detail API"
```

---

### Task 9: Companies — list + detail API

**Files:**
- Modify: `src/repositories/companies.repository.ts` (add `listByOrganization`, `findById`)
- Create: `src/services/company.service.ts`
- Create: `src/app/api/companies/route.ts` (GET)
- Create: `src/app/api/companies/[id]/route.ts` (GET)
- Test: `src/repositories/companies.repository.test.ts`
- Test: `src/app/api/companies/route.test.ts`

**Interfaces:**
- Produces: `CompaniesRepository.listByOrganization(db, organizationId): Promise<Company[]>` — ordered by `createdAt desc`. `CompaniesRepository.findById(db, organizationId, companyId): Promise<Company | null>` — neither existed before (only `findByName`/`create`).
- Produces: `CompanyService.listByOrganization`/`.findById` from `src/services/company.service.ts` — thin wrappers.
- Produces: `GET /api/companies?organizationId=`, `200`. `GET /api/companies/:id?organizationId=`, `200` or `404`.

- [ ] **Step 1: Write the failing repository test**

```typescript
// append to src/repositories/companies.repository.test.ts (check the file first — it
// currently has a `findByName` test; add these alongside it)

it("lists companies by organization, and finds one by id", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
  const created = await CompaniesRepository.create(db, org.id, { name: "Bella Cosméticos" });

  const list = await CompaniesRepository.listByOrganization(db, org.id);
  expect(list.some((row) => row.id === created.id)).toBe(true);

  const found = await CompaniesRepository.findById(db, org.id, created.id);
  expect(found?.name).toBe("Bella Cosméticos");

  const notFound = await CompaniesRepository.findById(db, org.id, "00000000-0000-0000-0000-000000000000");
  expect(notFound).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/companies.repository.test.ts`
Expected: FAIL — `listByOrganization`/`findById` don't exist.

- [ ] **Step 3: Implement the repository methods**

```typescript
// src/repositories/companies.repository.ts
// Add `desc` to the existing drizzle-orm import line.

// Add inside the exported CompaniesRepository object:
  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Company[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(companies)
        .where(eq(companies.organizationId, organizationId))
        .orderBy(desc(companies.createdAt));
    });
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    companyId: string,
  ): Promise<Company | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(companies)
        .where(and(eq(companies.id, companyId), eq(companies.organizationId, organizationId)));
      return row ?? null;
    });
  },
```

- [ ] **Step 4: Run the repository test to verify it passes**

Run: `pnpm vitest run src/repositories/companies.repository.test.ts`
Expected: PASS

- [ ] **Step 5: Implement `CompanyService`**

```typescript
// src/services/company.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { CompaniesRepository, type Company } from "@/repositories/companies.repository";

export const CompanyService = {
  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Company[]> {
    return CompaniesRepository.listByOrganization(db, organizationId);
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    companyId: string,
  ): Promise<Company | null> {
    return CompaniesRepository.findById(db, organizationId, companyId);
  },
};
```

- [ ] **Step 6: Write the failing route test**

```typescript
// src/app/api/companies/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { CompaniesRepository } from "@/repositories/companies.repository";

describe("GET /api/companies", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the organization's companies", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const company = await CompaniesRepository.create(db, org.id, { name: "Bella Cosméticos" });

    const { GET } = await import("./route");

    const request = new Request(`http://localhost/api/companies?organizationId=${org.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === company.id)).toBe(true);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/companies/route.test.ts`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 8: Implement the routes**

```typescript
// src/app/api/companies/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CompanyService } from "@/services/company.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });
  const list = await CompanyService.listByOrganization(db, payload.organizationId);
  return NextResponse.json(list, { status: 200 });
}
```

```typescript
// src/app/api/companies/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CompanyService } from "@/services/company.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const company = await CompanyService.findById(db, payload.organizationId, id);
  if (!company) {
    return NextResponse.json({ error: `Company ${id} not found` }, { status: 404 });
  }
  return NextResponse.json(company, { status: 200 });
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/companies/route.test.ts`
Expected: PASS

- [ ] **Step 10: Verify the app builds, run the full suite, then commit**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test pnpm build
pnpm test
git add src/repositories/companies.repository.ts src/repositories/companies.repository.test.ts src/services/company.service.ts src/app/api/companies
git commit -m "feat: add Companies list and detail API"
```

---

### Task 10: Contacts — list + detail API

**Files:**
- Modify: `src/repositories/contacts.repository.ts` (add `listByOrganization`)
- Create: `src/services/contact.service.ts`
- Create: `src/app/api/contacts/route.ts` (GET)
- Create: `src/app/api/contacts/[id]/route.ts` (GET)
- Test: `src/repositories/contacts.repository.test.ts`
- Test: `src/app/api/contacts/route.test.ts`

**Interfaces:**
- Produces: `ContactsRepository.listByOrganization(db, organizationId): Promise<Contact[]>` — ordered by `createdAt desc`. `findById`/`findByIdWithTx` already exist from Milestone 2.
- Produces: `ContactService.listByOrganization`/`.findById` from `src/services/contact.service.ts`.
- Produces: `GET /api/contacts?organizationId=`, `200`. `GET /api/contacts/:id?organizationId=`, `200` or `404`.

- [ ] **Step 1: Write the failing repository test**

```typescript
// append to src/repositories/contacts.repository.test.ts (check the file first for its
// existing test structure)

it("lists contacts by organization, ordered by createdAt desc", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
  const created = await ContactsRepository.create(db, org.id, { fullName: "Maria" });

  const list = await ContactsRepository.listByOrganization(db, org.id);
  expect(list.some((row) => row.id === created.id)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/contacts.repository.test.ts`
Expected: FAIL — `listByOrganization` doesn't exist.

- [ ] **Step 3: Implement the repository method**

```typescript
// src/repositories/contacts.repository.ts
// Add `desc` to the existing drizzle-orm import line.

// Add inside the exported ContactsRepository object:
  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Contact[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(contacts)
        .where(eq(contacts.organizationId, organizationId))
        .orderBy(desc(contacts.createdAt));
    });
  },
```

- [ ] **Step 4: Run the repository test to verify it passes**

Run: `pnpm vitest run src/repositories/contacts.repository.test.ts`
Expected: PASS

- [ ] **Step 5: Implement `ContactService`**

```typescript
// src/services/contact.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { ContactsRepository, type Contact } from "@/repositories/contacts.repository";

export const ContactService = {
  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Contact[]> {
    return ContactsRepository.listByOrganization(db, organizationId);
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    contactId: string,
  ): Promise<Contact | null> {
    return ContactsRepository.findById(db, organizationId, contactId);
  },
};
```

- [ ] **Step 6: Write the failing route test**

```typescript
// src/app/api/contacts/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { ContactsRepository } from "@/repositories/contacts.repository";

describe("GET /api/contacts", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the organization's contacts", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const contact = await ContactsRepository.create(db, org.id, { fullName: "Maria" });

    const { GET } = await import("./route");

    const request = new Request(`http://localhost/api/contacts?organizationId=${org.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === contact.id)).toBe(true);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/contacts/route.test.ts`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 8: Implement the routes**

```typescript
// src/app/api/contacts/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ContactService } from "@/services/contact.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });
  const list = await ContactService.listByOrganization(db, payload.organizationId);
  return NextResponse.json(list, { status: 200 });
}
```

```typescript
// src/app/api/contacts/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ContactService } from "@/services/contact.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const contact = await ContactService.findById(db, payload.organizationId, id);
  if (!contact) {
    return NextResponse.json({ error: `Contact ${id} not found` }, { status: 404 });
  }
  return NextResponse.json(contact, { status: 200 });
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/contacts/route.test.ts`
Expected: PASS

- [ ] **Step 10: Verify the app builds, run the full suite, then commit**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test pnpm build
pnpm test
git add src/repositories/contacts.repository.ts src/repositories/contacts.repository.test.ts src/services/contact.service.ts src/app/api/contacts
git commit -m "feat: add Contacts list and detail API"
```

---

### Task 11: Extract `ProposalVersionService`

**Files:**
- Modify: `src/repositories/proposal-versions.repository.ts` (strip to persistence-only)
- Create: `src/services/proposal-version.service.ts`
- Modify: `src/services/proposal.service.ts` (call site)
- Modify: `src/services/proposal-item.service.ts` (call site)
- Modify: `src/services/proposal-block.service.ts` (call site)
- Test: `src/repositories/proposal-versions.repository.test.ts`
- Test: `src/services/proposal-version.service.test.ts` (new)

**Interfaces:**
- Produces: `ProposalVersionService.createVersionWithTx(tx, organizationId, proposalId, createdBy): Promise<ProposalVersion>` and `.listByProposal(db, organizationId, proposalId): Promise<ProposalVersion[]>` from `src/services/proposal-version.service.ts` — this is the new call boundary every other module uses; nothing outside this file calls `ProposalVersionsRepository` directly anymore for version creation.
- `ProposalVersionsRepository` is reduced to: `insertWithTx(tx, organizationId, proposalId, versionNumber, snapshotJson, createdBy): Promise<ProposalVersion>`, `countByProposalWithTx(tx, organizationId, proposalId): Promise<number>`, `listByProposal(db, organizationId, proposalId): Promise<ProposalVersion[]>`. It no longer exports `buildSnapshotWithTx` or `createVersionWithTx`, and no longer imports `ProposalsRepository`/`ProposalItemsRepository`/`ProposalBlocksRepository` (that cross-repository orchestration moves to the service).
- `ProposalSnapshot` type moves to `src/services/proposal-version.service.ts` (it's the shape the service builds, not something the repository needs to know about beyond storing/returning opaque `jsonb`).

**This task must preserve behavior exactly** — the version-numbering algorithm
(`count of existing versions + 1`) and the snapshot shape (`{proposal: {title, template,
status}, items, blocks}`) do not change, only which file they live in.

- [ ] **Step 1: Read the current repository test file to preserve its test intent**

Read `src/repositories/proposal-versions.repository.test.ts` in full before touching
anything — its existing test ("builds a snapshot including current items, and creates
sequential version numbers") exercises `ProposalVersionsRepository.createVersionWithTx`
directly. That test will move to `proposal-version.service.test.ts` in Step 6 below, since
the behavior it tests is moving to the service — do not leave a stale duplicate test
in the repository test file asserting against a method that no longer exists there.

- [ ] **Step 2: Write the new repository test (persistence-only surface)**

```typescript
// src/repositories/proposal-versions.repository.test.ts
// Replace the file's content with this — it now tests only the persistence
// primitives, not snapshot-building or version-number derivation.
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { ProposalsRepository } from "./proposals.repository";
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

  it("inserts a version row and counts existing versions for a proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, user, proposal } = await setup(db);

    const countBefore = await runInTenantContext(db, org.id, (tx) =>
      ProposalVersionsRepository.countByProposalWithTx(tx, org.id, proposal.id),
    );
    expect(countBefore).toBe(0);

    const version = await runInTenantContext(db, org.id, (tx) =>
      ProposalVersionsRepository.insertWithTx(tx, org.id, proposal.id, 1, { proposal: { title: "P" } }, user.id),
    );
    expect(version.versionNumber).toBe(1);

    const countAfter = await runInTenantContext(db, org.id, (tx) =>
      ProposalVersionsRepository.countByProposalWithTx(tx, org.id, proposal.id),
    );
    expect(countAfter).toBe(1);

    const list = await ProposalVersionsRepository.listByProposal(db, org.id, proposal.id);
    expect(list).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/proposal-versions.repository.test.ts`
Expected: FAIL — `insertWithTx`/`countByProposalWithTx` don't exist yet.

- [ ] **Step 4: Rewrite the repository**

```typescript
// src/repositories/proposal-versions.repository.ts
import { and, count, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalVersions } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";

export type ProposalVersion = typeof proposalVersions.$inferSelect;

export const ProposalVersionsRepository = {
  async countByProposalWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<number> {
    const [{ value }] = await tx
      .select({ value: count() })
      .from(proposalVersions)
      .where(and(eq(proposalVersions.proposalId, proposalId), eq(proposalVersions.organizationId, organizationId)));
    return value;
  },

  async insertWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    versionNumber: number,
    snapshotJson: unknown,
    createdBy: string,
  ): Promise<ProposalVersion> {
    const [version] = await tx
      .insert(proposalVersions)
      .values({ organizationId, proposalId, versionNumber, snapshotJson, createdBy })
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

- [ ] **Step 5: Run the repository test to verify it passes**

Run: `pnpm vitest run src/repositories/proposal-versions.repository.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing service test (moves the old repository test's intent here)**

```typescript
// src/services/proposal-version.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalItemsRepository } from "@/repositories/proposal-items.repository";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalVersionService } from "./proposal-version.service";

describe("ProposalVersionService", () => {
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
      ProposalVersionService.createVersionWithTx(tx, org.id, proposal.id, user.id),
    );
    expect(v1.versionNumber).toBe(1);
    expect((v1.snapshotJson as any).items).toHaveLength(1);
    expect((v1.snapshotJson as any).proposal.title).toBe("P");

    const v2 = await runInTenantContext(db, org.id, (tx) =>
      ProposalVersionService.createVersionWithTx(tx, org.id, proposal.id, user.id),
    );
    expect(v2.versionNumber).toBe(2);

    const list = await ProposalVersionService.listByProposal(db, org.id, proposal.id);
    expect(list).toHaveLength(2);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run src/services/proposal-version.service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 8: Implement `ProposalVersionService`**

```typescript
// src/services/proposal-version.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  ProposalVersionsRepository,
  type ProposalVersion,
} from "@/repositories/proposal-versions.repository";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalItemsRepository, type ProposalItem } from "@/repositories/proposal-items.repository";
import { ProposalBlocksRepository, type ProposalBlock } from "@/repositories/proposal-blocks.repository";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

export interface ProposalSnapshot {
  proposal: { title: string; template: string; status: string };
  items: ProposalItem[];
  blocks: ProposalBlock[];
}

async function buildSnapshotWithTx(
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
}

export const ProposalVersionService = {
  async createVersionWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    createdBy: string,
  ): Promise<ProposalVersion> {
    const snapshot = await buildSnapshotWithTx(tx, organizationId, proposalId);
    const existingCount = await ProposalVersionsRepository.countByProposalWithTx(
      tx,
      organizationId,
      proposalId,
    );
    return ProposalVersionsRepository.insertWithTx(
      tx,
      organizationId,
      proposalId,
      existingCount + 1,
      snapshot,
      createdBy,
    );
  },

  async listByProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalVersion[]> {
    return ProposalVersionsRepository.listByProposal(db, organizationId, proposalId);
  },
};
```

- [ ] **Step 9: Run the service test to verify it passes**

Run: `pnpm vitest run src/services/proposal-version.service.test.ts`
Expected: PASS

- [ ] **Step 10: Update the three call sites**

In `src/services/proposal.service.ts`, `src/services/proposal-item.service.ts`, and
`src/services/proposal-block.service.ts`: replace every
`ProposalVersionsRepository.createVersionWithTx(tx, organizationId, proposalId, userId)`
call with `ProposalVersionService.createVersionWithTx(tx, organizationId, proposalId, userId)`,
and change the import from
`import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";`
to
`import { ProposalVersionService } from "./proposal-version.service";`
(adjust the relative path if the existing import used a different alias style — check each
file's current import block first).

- [ ] **Step 11: Run the full suite to confirm nothing broke**

Run: `pnpm test`
Expected: all pass — `proposal.service.test.ts`, `proposal-item.service.test.ts`, and
`proposal-block.service.test.ts`'s existing versioning assertions (both "writes a new
version" and "no-op doesn't write a version" tests) should all still pass unchanged, since
this is a pure call-site rename with identical behavior underneath.

- [ ] **Step 12: Verify the app builds, then commit**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test pnpm build
git add src/repositories/proposal-versions.repository.ts src/repositories/proposal-versions.repository.test.ts src/services/proposal-version.service.ts src/services/proposal-version.service.test.ts src/services/proposal.service.ts src/services/proposal-item.service.ts src/services/proposal-block.service.ts
git commit -m "refactor: extract ProposalVersionService, reduce ProposalVersionsRepository to persistence"
```

---

### Task 12: Route Proposals' GET endpoints through the Service layer

**Files:**
- Modify: `src/services/proposal.service.ts` (add `listByOpportunity`)
- Modify: `src/app/api/proposals/route.ts` (GET uses the service)
- Modify: `src/app/api/proposals/[id]/versions/route.ts` (GET uses `ProposalVersionService`)
- Test: `src/services/proposal.service.test.ts`

**Interfaces:**
- Produces: `ProposalService.listByOpportunity(db, organizationId, opportunityId): Promise<Proposal[]>` — thin wrapper over `ProposalsRepository.listByOpportunity` (already exists).
- Consumes: `ProposalVersionService.listByProposal` (Task 11).

**This task changes only which layer the two GET routes call through — response shape and
status codes are unchanged.**

- [ ] **Step 1: Write the failing test**

```typescript
// append to src/services/proposal.service.test.ts
it("lists proposals by opportunity", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;
  const { organization, owner, opportunity } = await setup(db); // reuse this file's existing setup helper

  const created = await ProposalService.create(db, organization.id, {
    opportunityId: opportunity.id,
    title: "Campanha Verão",
    template: "PREMIUM",
    userId: owner.id,
  });

  const list = await ProposalService.listByOpportunity(db, organization.id, opportunity.id);
  expect(list.some((row) => row.id === created.id)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/proposal.service.test.ts`
Expected: FAIL — `listByOpportunity` doesn't exist on `ProposalService`.

- [ ] **Step 3: Add the service method**

```typescript
// src/services/proposal.service.ts
// Add inside the exported ProposalService object:
  async listByOpportunity(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
  ): Promise<Proposal[]> {
    return ProposalsRepository.listByOpportunity(db, organizationId, opportunityId);
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/proposal.service.test.ts`
Expected: PASS

- [ ] **Step 5: Update the two routes**

```typescript
// src/app/api/proposals/route.ts
// Replace the GET handler's list line:
// OLD: const list = await ProposalsRepository.listByOpportunity(db, payload.organizationId, payload.opportunityId);
// NEW:
  const list = await ProposalService.listByOpportunity(db, payload.organizationId, payload.opportunityId);
```

Remove the now-unused `import { ProposalsRepository } from "@/repositories/proposals.repository";`
from this file if `ProposalsRepository` isn't referenced anywhere else in it (check first —
it's likely only used by this one line).

```typescript
// src/app/api/proposals/[id]/versions/route.ts
// Replace:
// import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
// with:
import { ProposalVersionService } from "@/services/proposal-version.service";

// Replace:
// const versions = await ProposalVersionsRepository.listByProposal(db, payload.organizationId, id);
// with:
  const versions = await ProposalVersionService.listByProposal(db, payload.organizationId, id);
```

- [ ] **Step 6: Run the existing route tests to confirm behavior is unchanged**

Run: `pnpm vitest run src/app/api/proposals/route.test.ts`
Expected: PASS (unchanged — this test already covers `POST`; if it doesn't cover `GET`,
that's a pre-existing gap outside this task's scope, not something to add here).

- [ ] **Step 7: Verify the app builds, run the full suite, then commit**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test pnpm build
pnpm test
git add src/services/proposal.service.ts src/services/proposal.service.test.ts src/app/api/proposals/route.ts "src/app/api/proposals/[id]/versions/route.ts"
git commit -m "refactor: route Proposals GET endpoints through the service layer"
```

---

## Self-Review

**Spec coverage:**
- Decisão #1 (creatorId ownership) — Task 1 (infra), Tasks 2-4 (the three call sites).
- Decisão #2 (read surface) — Tasks 5-10 cover Commercial Inquiries, Opportunities (+detail),
  Leads, Companies, Contacts.
- Decisão #3 (stage change + history) — Task 7.
- Decisão #4 (thin services for Leads/Companies/Contacts, not direct repository calls from
  routes) — Tasks 8-10 each add a service even though today it's a pure wrapper.
- Decisão #5 (ProposalVersionsRepository → persistence-only) — Task 11.
- Decisão #6 (Proposals GETs via service) — Task 12.
- Decisão #7 (document the Company/Contact org-scope vs Lead/Opportunity creator-scope
  decision) — done in the design spec itself (§3), no code task needed.
- §5 "fora desta wave" — no task in this plan touches `converted_lead_id`/
  `linked_opportunity_id` FKs, snapshot ordering, error-class deduplication,
  `proposals.creator_id`, a generic HTTP error layer, Milestone 2's old unmapped errors, or
  `userId` requirements on non-Proposals modules. Correctly absent.

**Placeholder scan:** no TBD/TODO. A few steps say "adapt to this file's actual existing
setup helper" (Tasks 5, 6, 7, 8) rather than inventing fixture code blind — this is
intentional: those test files already have established setup helpers from the original
milestone plans, and duplicating slightly-different fixture code would risk drift. The
assertions themselves are concrete in every case.

**Type consistency:** `CreatorNotFoundError`, `OpportunityNotFoundError` are each defined
once and reused by name across all consuming tasks. `existsForOrganization`/
`existsForOrganizationWithTx` naming and parameter order (`db/tx, organizationId, id`)
matches `OrganizationMembersRepository`'s existing convention exactly, as required.
`ProposalVersionService.createVersionWithTx`'s signature
(`tx, organizationId, proposalId, createdBy`) is identical to the old
`ProposalVersionsRepository.createVersionWithTx`'s, so Task 11's call-site updates
(Step 10) are a pure rename with no parameter reshuffling.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-backend-audit-fix-wave.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
