# Proposal Read APIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three missing read endpoints the Proposal Builder UI needs to load a proposal
on open: `GET /api/proposals/:id`, `GET /api/proposals/:id/items`, `GET /api/proposals/:id/blocks`.

**Architecture:** Each endpoint follows the exact pattern already established by
`GET /api/opportunities/:id`: a required `organizationId` query param, a thin new service-layer
pass-through method (the repository methods already exist), and a route handler that maps a
not-found repository result to `404`. Three independent tasks, one per endpoint — each is a
complete, testable vertical slice (service method + route + tests) with no shared code between
tasks beyond what's already merged.

**Tech Stack:** Next.js 16 Route Handlers, Drizzle ORM, Zod, Vitest, `withTestDb` test helper.

## Global Constraints

- `organizationId` is a required query string param on every route in this plan (not a request
  body field — these are `GET` requests) — mirrors `GET /api/opportunities/:id` exactly
  (`src/app/api/opportunities/[id]/route.ts`).
- No enrichment, no joins, no derived fields — every response is the bare Drizzle row(s) exactly
  as `$inferSelect` produces them.
- No pagination on the two list endpoints (`items`, `blocks`) — return the full array, matching
  every other list endpoint in this codebase.
- An empty list (proposal exists but has zero items/blocks) returns `200` with `[]` — not `404`.
  `404` is reserved for "the proposal itself does not exist."
- No changes to any existing `POST`/`PATCH`/`DELETE` route, service method, or repository method
  in the Proposals domain — this plan is additive only.

---

### Task 1: `GET /api/proposals/:id`

**Files:**
- Modify: `src/services/proposal.service.ts`
- Modify: `src/app/api/proposals/[id]/route.ts`
- Test: `src/services/proposal.service.test.ts`
- Test: `src/app/api/proposals/[id]/route.test.ts`

**Interfaces:**
- Consumes: `ProposalsRepository.findById(db, organizationId, proposalId): Promise<Proposal | null>`
  (already exists, `src/repositories/proposals.repository.ts:96-102`).
- Produces: `ProposalService.findById(db, organizationId, proposalId): Promise<Proposal | null>`
  — a new export on the existing `ProposalService` object. Route handler `GET` exported from
  `src/app/api/proposals/[id]/route.ts` (that file already exports `PATCH` — this adds `GET`
  alongside it, same file, same pattern as `src/app/api/opportunities/[id]/route.ts` which
  exports both `GET` and `PATCH`).

- [ ] **Step 1: Write the failing service test**

Read `src/services/proposal.service.test.ts` first — it already has a `setup(db)` helper
(creates org+owner, creator, contact, lead, opportunity) used by every test in the file. Add
this new test using that same helper:

```typescript
it("findById returns the proposal, or null if it doesn't exist", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;
  const { organization, owner, opportunity } = await setup(db);

  const proposal = await ProposalService.create(db, organization.id, {
    opportunityId: opportunity.id,
    title: "Campanha Verão",
    template: "PREMIUM",
    userId: owner.id,
  });

  const found = await ProposalService.findById(db, organization.id, proposal.id);
  expect(found).not.toBeNull();
  expect(found?.title).toBe("Campanha Verão");

  const missing = await ProposalService.findById(
    db,
    organization.id,
    "00000000-0000-0000-0000-000000000000",
  );
  expect(missing).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/proposal.service.test.ts`
Expected: FAIL — `ProposalService.findById` is not a function.

- [ ] **Step 3: Implement `ProposalService.findById`**

In `src/services/proposal.service.ts`, add this method to the `ProposalService` object (a thin
pass-through, no transaction/membership logic needed — this is a read, and every other read
method on this service, `listByOpportunity`, is also a plain pass-through with no `assertMember`
call):

```typescript
  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<Proposal | null> {
    return ProposalsRepository.findById(db, organizationId, proposalId);
  },
```

Add this method after `listByOpportunity` (the last method in the object) — no new imports
needed, `ProposalsRepository` is already imported at the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/proposal.service.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Write the failing route test**

Create `src/app/api/proposals/[id]/route.test.ts` (this file does not exist yet — only
`PATCH`-related behavior was ever tested via `src/app/api/proposals/route.test.ts`, which tests
the `POST` route in the parent directory, a different file):

```typescript
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ProposalService } from "@/services/proposal.service";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("GET /api/proposals/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the proposal", async () => {
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
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: owner.id,
    });

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/proposals/${proposal.id}?organizationId=${organization.id}`,
    );
    const response = await GET(request, { params: Promise.resolve({ id: proposal.id }) });
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.title).toBe("Campanha Verão");
  });

  it("returns 404 when the proposal does not exist", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner2@publyflow.test",
      ownerFullName: "Owner",
    });

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/proposals/00000000-0000-0000-0000-000000000000?organizationId=${organization.id}`,
    );
    const response = await GET(request, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/proposals/[id]/route.test.ts`
Expected: FAIL — `./route` has no exported `GET`.

- [ ] **Step 7: Implement the `GET` route handler**

Read the current content of `src/app/api/proposals/[id]/route.ts` first (it currently only
exports `PATCH`). Add this `GET` handler, mirroring
`src/app/api/opportunities/[id]/route.ts`'s `GET` exactly — insert it before the existing
`templateEnum`/`statusEnum`/`updateSchema`/`PATCH` code, at the top of the file, right after the
existing imports:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalService } from "@/services/proposal.service";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

const getQuerySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = getQuerySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const proposal = await ProposalService.findById(db, payload.organizationId, id);
  if (!proposal) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }
  return NextResponse.json(proposal, { status: 200 });
}

// ... existing templateEnum / statusEnum / updateSchema / PATCH below, unchanged ...
```

Note `ProposalNotFoundError` is not currently imported in this file — add it to the imports.
`z` and `NextResponse`/`db` are already imported by the existing `PATCH` code; do not duplicate
those import lines, just add the one new import (`ProposalNotFoundError`) and the `getQuerySchema`
constant plus the `GET` function above the existing code.

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/proposals/[id]/route.test.ts`
Expected: PASS (both cases)

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/services/proposal.service.ts src/services/proposal.service.test.ts src/app/api/proposals/[id]/route.ts src/app/api/proposals/[id]/route.test.ts
git commit -m "feat: add GET /api/proposals/:id"
```

---

### Task 2: `GET /api/proposals/:id/items`

**Files:**
- Modify: `src/services/proposal-item.service.ts`
- Create: `src/app/api/proposals/[id]/items/route.test.ts` (adds to the existing
  `src/app/api/proposals/[id]/items/route.ts`, which currently only exports `POST`)
- Modify: `src/app/api/proposals/[id]/items/route.ts`
- Test: `src/services/proposal-item.service.test.ts`

**Interfaces:**
- Consumes: `ProposalItemsRepository.listByProposal(db, organizationId, proposalId): Promise<ProposalItem[]>`
  (already exists, `src/repositories/proposal-items.repository.ts:161-169`).
- Produces: `ProposalItemService.listByProposal(db, organizationId, proposalId): Promise<ProposalItem[]>`
  — new export on `ProposalItemService`. `GET` handler exported alongside the existing `POST` in
  `src/app/api/proposals/[id]/items/route.ts`.

- [ ] **Step 1: Write the failing service test**

Read `src/services/proposal-item.service.test.ts` first — it has its own `setup(db)` helper
(same shape as Task 1's, likely also creating a proposal via `ProposalService.create`). Add this
test using the file's existing helper and `ProposalItemService.addItem` (already implemented) to
seed items:

```typescript
it("listByProposal returns all items added to the proposal", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;
  const { organization, owner, proposal } = await setup(db);

  await ProposalItemService.addItem(db, organization.id, {
    proposalId: proposal.id,
    description: "Sessão de fotos",
    unitPrice: 150000,
    userId: owner.id,
  });
  await ProposalItemService.addItem(db, organization.id, {
    proposalId: proposal.id,
    description: "Desconto negociado",
    unitPrice: -20000,
    userId: owner.id,
  });

  const items = await ProposalItemService.listByProposal(db, organization.id, proposal.id);
  expect(items).toHaveLength(2);
  expect(items.map((item) => item.description).sort()).toEqual([
    "Desconto negociado",
    "Sessão de fotos",
  ]);
});

it("listByProposal returns an empty array for a proposal with no items", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;
  const { organization, proposal } = await setup(db);

  const items = await ProposalItemService.listByProposal(db, organization.id, proposal.id);
  expect(items).toEqual([]);
});
```

If the file's existing `setup(db)` helper does not already return a `proposal` (check its
current return statement first — it may only return `{organization, owner, opportunity}` like
Task 1's service-test helper), extend it to also create and return a proposal via
`ProposalService.create(db, organization.id, {opportunityId: opportunity.id, title: "Campanha Verão", template: "PREMIUM", userId: owner.id})`
and add `proposal` to its returned object — read the file first and make the smallest change
that fits its current shape (it almost certainly already creates a proposal somewhere in its
setup, since every other test in that file needs one to call `addItem` against — reuse whatever
is already there rather than inventing a second setup path).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/proposal-item.service.test.ts`
Expected: FAIL — `ProposalItemService.listByProposal` is not a function.

- [ ] **Step 3: Implement `ProposalItemService.listByProposal`**

In `src/services/proposal-item.service.ts`, add this method to the `ProposalItemService` object
(after `removeItem`, the last method — thin pass-through, no membership check, matching
`ProposalService.listByOpportunity`'s read-only pattern from Task 1):

```typescript
  async listByProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalItem[]> {
    return ProposalItemsRepository.listByProposal(db, organizationId, proposalId);
  },
```

No new imports needed — `ProposalItemsRepository` is already imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/proposal-item.service.test.ts`
Expected: PASS (all tests in the file, including both new ones)

- [ ] **Step 5: Write the failing route test**

Create `src/app/api/proposals/[id]/items/route.test.ts`:

```typescript
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ProposalService } from "@/services/proposal.service";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("GET /api/proposals/:id/items", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the proposal's items", async () => {
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
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: owner.id,
    });

    const { POST } = await import("./route");
    await POST(
      new Request(`http://localhost/api/proposals/${proposal.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: organization.id,
          userId: owner.id,
          description: "Sessão de fotos",
          unitPrice: 150000,
        }),
      }),
      { params: Promise.resolve({ id: proposal.id }) },
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request(`http://localhost/api/proposals/${proposal.id}/items?organizationId=${organization.id}`),
      { params: Promise.resolve({ id: proposal.id }) },
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toHaveLength(1);
    expect(json[0].description).toBe("Sessão de fotos");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/proposals/[id]/items/route.test.ts`
Expected: FAIL — `./route` has no exported `GET`.

- [ ] **Step 7: Implement the `GET` route handler**

Read the current content of `src/app/api/proposals/[id]/items/route.ts` first (it currently only
exports `POST`, with its own imports for `NextResponse`, `z`, `db`, `ProposalItemService`, and
several error classes). Add this `GET` handler — insert it before the existing `POST`, right
after the file's existing imports and before the `catalogSchema`/`adHocSchema`/`bodySchema`
declarations:

```typescript
const getQuerySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = getQuerySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const items = await ProposalItemService.listByProposal(db, payload.organizationId, id);
  return NextResponse.json(items, { status: 200 });
}
```

`NextResponse`, `z`, `db`, and `ProposalItemService` are all already imported by the existing
`POST` handler — do not duplicate those import lines. No 404 handling needed here: an unknown
`proposalId` simply yields an empty `[]` from the repository (no error thrown), which is correct
per this plan's Global Constraints (only the single-proposal `GET` from Task 1 needs a 404 path;
this endpoint's job is "list whatever items belong to this proposal id," and an empty result for
a bogus id is indistinguishable from — and no worse than — an empty result for a real proposal
with no items yet).

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/proposals/[id]/items/route.test.ts`
Expected: PASS

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/services/proposal-item.service.ts src/services/proposal-item.service.test.ts src/app/api/proposals/[id]/items/route.ts src/app/api/proposals/[id]/items/route.test.ts
git commit -m "feat: add GET /api/proposals/:id/items"
```

---

### Task 3: `GET /api/proposals/:id/blocks`

**Files:**
- Modify: `src/services/proposal-block.service.ts`
- Create: `src/app/api/proposals/[id]/blocks/route.test.ts`
- Modify: `src/app/api/proposals/[id]/blocks/route.ts`
- Test: `src/services/proposal-block.service.test.ts`

**Interfaces:**
- Consumes: `ProposalBlocksRepository.listByProposal(db, organizationId, proposalId): Promise<ProposalBlock[]>`
  (already exists, `src/repositories/proposal-blocks.repository.ts:155-163`).
- Produces: `ProposalBlockService.listByProposal(db, organizationId, proposalId): Promise<ProposalBlock[]>`
  — new export on `ProposalBlockService`. `GET` handler exported alongside the existing `POST`
  in `src/app/api/proposals/[id]/blocks/route.ts`.

- [ ] **Step 1: Write the failing service test**

Read `src/services/proposal-block.service.test.ts` first (same shape expectation as Task 2's
service test — a `setup(db)` helper that already creates a proposal, reused here). Add:

```typescript
it("listByProposal returns all blocks added to the proposal", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;
  const { organization, owner, proposal } = await setup(db);

  await ProposalBlockService.addBlock(db, organization.id, {
    proposalId: proposal.id,
    blockType: "COVER",
    content: { headline: "Campanha Verão" },
    userId: owner.id,
  });
  await ProposalBlockService.addBlock(db, organization.id, {
    proposalId: proposal.id,
    blockType: "TEXT",
    content: { body: "Uma proposta especial para sua marca." },
    userId: owner.id,
  });

  const blocks = await ProposalBlockService.listByProposal(db, organization.id, proposal.id);
  expect(blocks).toHaveLength(2);
  expect(blocks.map((block) => block.blockType).sort()).toEqual(["COVER", "TEXT"]);
});

it("listByProposal returns an empty array for a proposal with no blocks", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;
  const { organization, proposal } = await setup(db);

  const blocks = await ProposalBlockService.listByProposal(db, organization.id, proposal.id);
  expect(blocks).toEqual([]);
});
```

As in Task 2, if the file's existing `setup(db)` helper doesn't already return `proposal`, read
the file first and extend it minimally to do so, reusing whatever proposal-creation code it
already has for its other tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/proposal-block.service.test.ts`
Expected: FAIL — `ProposalBlockService.listByProposal` is not a function.

- [ ] **Step 3: Implement `ProposalBlockService.listByProposal`**

In `src/services/proposal-block.service.ts`, add this method to the `ProposalBlockService`
object (after `removeBlock`, the last method):

```typescript
  async listByProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalBlock[]> {
    return ProposalBlocksRepository.listByProposal(db, organizationId, proposalId);
  },
```

No new imports needed — `ProposalBlocksRepository` is already imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/proposal-block.service.test.ts`
Expected: PASS (all tests in the file, including both new ones)

- [ ] **Step 5: Write the failing route test**

Create `src/app/api/proposals/[id]/blocks/route.test.ts`:

```typescript
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ProposalService } from "@/services/proposal.service";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("GET /api/proposals/:id/blocks", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the proposal's blocks", async () => {
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
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: owner.id,
    });

    const { POST } = await import("./route");
    await POST(
      new Request(`http://localhost/api/proposals/${proposal.id}/blocks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: organization.id,
          userId: owner.id,
          blockType: "COVER",
          content: { headline: "Campanha Verão" },
        }),
      }),
      { params: Promise.resolve({ id: proposal.id }) },
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request(`http://localhost/api/proposals/${proposal.id}/blocks?organizationId=${organization.id}`),
      { params: Promise.resolve({ id: proposal.id }) },
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toHaveLength(1);
    expect(json[0].blockType).toBe("COVER");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/proposals/[id]/blocks/route.test.ts`
Expected: FAIL — `./route` has no exported `GET`.

- [ ] **Step 7: Implement the `GET` route handler**

Read the current content of `src/app/api/proposals/[id]/blocks/route.ts` first (it currently
only exports `POST`, with its own imports for `NextResponse`, `z`, `db`, `ProposalBlockService`,
and `ProposalNotFoundError`). Add this `GET` handler — insert it before the existing `POST`,
right after the file's existing imports and before the `blockTypeEnum`/`bodySchema`
declarations:

```typescript
const getQuerySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = getQuerySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const blocks = await ProposalBlockService.listByProposal(db, payload.organizationId, id);
  return NextResponse.json(blocks, { status: 200 });
}
```

`NextResponse`, `z`, `db`, and `ProposalBlockService` are all already imported by the existing
`POST` handler — do not duplicate those import lines. Same no-404 rationale as Task 2's items
route: an empty array for any `proposalId` (real with no blocks, or bogus) is correct here.

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/proposals/[id]/blocks/route.test.ts`
Expected: PASS

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/services/proposal-block.service.ts src/services/proposal-block.service.test.ts src/app/api/proposals/[id]/blocks/route.ts src/app/api/proposals/[id]/blocks/route.test.ts
git commit -m "feat: add GET /api/proposals/:id/blocks"
```

---

## Self-Review

**Spec coverage:**
- Decisão #1 (`GET /api/proposals/:id`, mirrors opportunities pattern, `ProposalService.findById`
  new) — Task 1.
- Decisão #2 (`GET /api/proposals/:id/items`, `ProposalItemService.listByProposal` new, no 404 on
  empty) — Task 2.
- Decisão #3 (`GET /api/proposals/:id/blocks`, `ProposalBlockService.listByProposal` new) —
  Task 3.
- Decisão #4 (no enrichment, bare rows) — every task returns the repository's row(s) directly via
  `NextResponse.json`, no mapping/joining added anywhere.
- Decisão #5 (no new write routes) — no task touches any `POST`/`PATCH`/`DELETE` handler or
  service method.
- "Fora de escopo" (no pagination, no enrichment, versions route untouched, no changes to
  `addItem`/`updateItem`/`removeItem` or their block equivalents) — confirmed: no task adds a
  pagination param, no task modifies `proposal-versions`, no task touches any mutating method.

**Placeholder scan:** none — every step has literal, complete code and exact commands.

**Type consistency:** `Proposal`, `ProposalItem`, `ProposalBlock` are all imported by name from
their respective repository files in every task — never redefined. `findById`/`listByProposal`
signatures (`db, organizationId, id`) are identical in shape across all three tasks and match the
`GET /api/opportunities/:id` precedent's `findById` signature exactly. The `getQuerySchema`
pattern (`z.object({ organizationId: z.string().uuid() })`) is repeated identically in all three
route files — this is intentional duplication of a 1-line schema per route file, matching how
`GET /api/opportunities/:id` and every other single-purpose route file in this codebase declares
its own local Zod schema rather than importing a shared one.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-23-proposal-read-apis.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
