# Ambiguous Party Guess Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `CommercialInquiryService.resolve` from silently picking an arbitrary company/
brand when more than one row shares the exact guessed name — surface it as a distinct,
catchable error instead, so the Inbox's 1-click convert flow can fall back to manual
resolution rather than possibly linking the wrong company.

**Architecture:** `CompaniesRepository`/`BrandsRepository` gain `listByName` (returns every
exact-name match, not just one) replacing the single-result `findByName` — which has exactly
one caller (`resolvePartyIdFromGuess`) and would otherwise become dead code once that caller
switches. `resolvePartyIdFromGuess` checks the match count (0/1/many) and throws a new
`AmbiguousPartyGuessError` on the "many" case. The `/convert` route, which today has zero
error mapping, gains a `try`/`catch` for exactly the three errors `resolve()` can throw.

**Tech Stack:** Drizzle ORM, PostgreSQL, Next.js Route Handlers, Zod, Vitest.

## Global Constraints

- `listByName(db, organizationId, name): Promise<Company[]>` (and the `Brand[]` equivalent)
  replaces `findByName` — same org-scoping (`and(eq(table.name, name), eq(table.organizationId, organizationId))`),
  returns an array instead of a single row/`null`.
- `resolvePartyIdFromGuess`: 0 matches → create (unchanged behavior). Exactly 1 match → reuse
  it (unchanged behavior). More than 1 match → throw `AmbiguousPartyGuessError` — this is the
  only new behavior.
- `AmbiguousPartyGuessError` lives in `src/domain/commercial-flow/errors.ts`, alongside
  `InquiryNotFoundError`/`InquiryAlreadyResolvedError` (the other errors `resolve()` throws).
- `POST /api/commercial-inquiries/[id]/convert` gains error mapping for exactly these three
  errors: `InquiryNotFoundError` → `404`, `InquiryAlreadyResolvedError` → `409`,
  `AmbiguousPartyGuessError` → `422`. This is a scoped addition serving this fix, not a
  general retrofit of the route's other unmapped-error behavior (there isn't any beyond these
  three, since `resolve()` doesn't throw anything else).
- No fuzzy/near-duplicate matching, no schema uniqueness constraint, no UI — out of scope.

---

### Task 1: `listByName` on `CompaniesRepository` and `BrandsRepository`

**Files:**
- Modify: `src/repositories/companies.repository.ts`
- Modify: `src/repositories/brands.repository.ts`
- Test: `src/repositories/companies.repository.test.ts`
- Test: `src/repositories/brands.repository.test.ts`

**Interfaces:**
- Produces: `CompaniesRepository.listByName(db, organizationId, name): Promise<Company[]>` —
  replaces `CompaniesRepository.findByName` (removed; its one caller is updated in Task 2).
- Produces: `BrandsRepository.listByName(db, organizationId, name): Promise<Brand[]>` —
  replaces `BrandsRepository.findByName` (removed; same reason).

- [ ] **Step 1: Write the failing test for `CompaniesRepository.listByName`**

Read the current content of `src/repositories/companies.repository.test.ts` first — it
already has a "finds a company by name" test using `findByName`; REPLACE that test (don't
leave it alongside a method that no longer exists) with this one:

```typescript
// replaces the "finds a company by name within the organization" test
it("lists every company matching an exact name within the organization", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;

  const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
  const created = await CompaniesRepository.create(db, org.id, { name: "Bella Cosméticos" });

  const matches = await CompaniesRepository.listByName(db, org.id, "Bella Cosméticos");
  expect(matches).toHaveLength(1);
  expect(matches[0]!.id).toBe(created.id);

  const noMatches = await CompaniesRepository.listByName(db, org.id, "Nome Inexistente");
  expect(noMatches).toEqual([]);

  // Two companies can legitimately share the exact same name (no uniqueness
  // constraint on `name`) -- listByName must surface both, not silently
  // pick one, since that's the whole point of this method existing.
  await CompaniesRepository.create(db, org.id, { name: "Bella Cosméticos" });
  const duplicateMatches = await CompaniesRepository.listByName(db, org.id, "Bella Cosméticos");
  expect(duplicateMatches).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/companies.repository.test.ts`
Expected: FAIL — `listByName` doesn't exist.

- [ ] **Step 3: Implement `CompaniesRepository.listByName`**

```typescript
// src/repositories/companies.repository.ts
// Replace the existing findByName method with:
  async listByName(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
  ): Promise<Company[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(companies)
        .where(and(eq(companies.name, name), eq(companies.organizationId, organizationId)));
    });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/companies.repository.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `BrandsRepository.listByName`**

`src/repositories/brands.repository.test.ts` doesn't exist yet — create it, following
`companies.repository.test.ts`'s exact structure:

```typescript
// src/repositories/brands.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { BrandsRepository } from "./brands.repository";

describe("BrandsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("lists every brand matching an exact name within the organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const created = await BrandsRepository.create(db, org.id, { name: "Linha Solar" });

    const matches = await BrandsRepository.listByName(db, org.id, "Linha Solar");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe(created.id);

    const noMatches = await BrandsRepository.listByName(db, org.id, "Nome Inexistente");
    expect(noMatches).toEqual([]);

    await BrandsRepository.create(db, org.id, { name: "Linha Solar" });
    const duplicateMatches = await BrandsRepository.listByName(db, org.id, "Linha Solar");
    expect(duplicateMatches).toHaveLength(2);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/brands.repository.test.ts`
Expected: FAIL — `listByName` doesn't exist, and the test file itself doesn't exist yet.

- [ ] **Step 7: Implement `BrandsRepository.listByName`**

```typescript
// src/repositories/brands.repository.ts
// Replace the existing findByName method with:
  async listByName(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
  ): Promise<Brand[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(brands)
        .where(and(eq(brands.name, name), eq(brands.organizationId, organizationId)));
    });
  },
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/brands.repository.test.ts`
Expected: PASS

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

`findByName` is now removed from both repositories — grep to confirm nothing else in `src/`
still calls it (Task 2 will be the one updating its only caller,
`resolvePartyIdFromGuess`, but that's fine to do out of order here since this step only
needs to confirm no ONE ELSE calls it — run `grep -rn "\.findByName(" src --include="*.ts"`
and expect the only hit to be inside `src/services/commercial-inquiry.service.ts`, which
Task 2 updates next).

```bash
grep -rn "\.findByName(" src --include="*.ts"
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
```

Expected: `pnpm test` FAILS at this point — `src/services/commercial-inquiry.service.ts`
still calls the now-removed `findByName`, and its own tests will fail to compile/run. This
is expected and resolved by Task 2; do not attempt to fix it in this task. Commit anyway —
the repository-layer change is complete and correct on its own; Task 2 restores the suite to
green as its own first step.

```bash
git add src/repositories/companies.repository.ts src/repositories/companies.repository.test.ts src/repositories/brands.repository.ts src/repositories/brands.repository.test.ts
git commit -m "feat: replace findByName with listByName on Companies/Brands repositories"
```

---

### Task 2: `AmbiguousPartyGuessError` + ambiguity detection in `resolvePartyIdFromGuess`

**Files:**
- Modify: `src/domain/commercial-flow/errors.ts`
- Modify: `src/services/commercial-inquiry.service.ts`
- Test: `src/services/commercial-inquiry.service.test.ts`

**Interfaces:**
- Consumes: `CompaniesRepository.listByName`/`BrandsRepository.listByName` (Task 1).
- Produces: `AmbiguousPartyGuessError` from `src/domain/commercial-flow/errors.ts` — thrown by
  `CommercialInquiryService.resolve` (via `resolvePartyIdFromGuess`) when a company/brand
  guess matches more than one existing row. Consumed by Task 3's route error mapping.

- [ ] **Step 1: Add the domain error**

```typescript
// src/domain/commercial-flow/errors.ts
// Add at the end of the file:

// Thrown by CommercialInquiryService.resolve (via resolvePartyIdFromGuess)
// when a company/brand guess matches more than one existing row by exact
// name -- companies.name/brands.name have no uniqueness constraint, so this
// can genuinely happen. Rather than arbitrarily picking one (which could
// silently link the inquiry to the wrong company), resolve() refuses and
// the caller must resolve the ambiguity explicitly (e.g. by passing an
// explicit companyId/brandId instead of relying on the guess).
export class AmbiguousPartyGuessError extends Error {
  constructor(guess: string) {
    super(`Multiple companies/brands match the name "${guess}" — cannot resolve automatically`);
    this.name = "AmbiguousPartyGuessError";
  }
}
```

- [ ] **Step 2: Write the failing service test**

Read the current content of `src/services/commercial-inquiry.service.test.ts` first — it
already imports `InquiryAlreadyResolvedError, InquiryNotFoundError` from
`@/domain/commercial-flow/errors` and has a `runInTenantContext`-based helper for inserting a
`companies` row directly (see the "resolves a new company into a Lead" test). Add
`AmbiguousPartyGuessError` to that import line, and add this new test:

```typescript
it("throws AmbiguousPartyGuessError when the company guess matches more than one existing company", async () => {
  const { db, cleanup: c } = await withTestDb();
  cleanup = c;
  const { organization, creator } = await setupOrgAndCreator(db);

  // Two companies sharing the exact same name -- no uniqueness constraint
  // stops this, and it's exactly the scenario resolve() must now refuse
  // to guess through.
  await runInTenantContext(db, organization.id, (tx) =>
    tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }),
  );
  await runInTenantContext(db, organization.id, (tx) =>
    tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }),
  );

  const ai = fakeAI({
    category: "COMMERCIAL_LEAD",
    commercialScore: 94,
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
  });

  const { inquiry } = await InboxService.ingestManualMessage(db, ai, organization.id, {
    creatorId: creator.id,
    source: "INSTAGRAM",
    externalContactLabel: "Maria — Bella Cosméticos",
    body: "Olá, gostaríamos de saber os valores.",
    receivedAt: new Date(),
  });

  // companyId omitted -- resolve() must try to resolve from the guess
  // ("Bella Cosméticos"), find it ambiguous, and refuse.
  await expect(
    CommercialInquiryService.resolve(db, organization.id, inquiry!.id, {
      contact: { fullName: "Maria" },
    }),
  ).rejects.toThrow(AmbiguousPartyGuessError);

  // The inquiry must remain unresolved -- resolve()'s transaction rolls
  // back entirely, same guarantee as the existing
  // "rolls back the Lead insert if the Opportunity create fails" test.
  const stillNew = await CommercialInquiryService.findById(db, organization.id, inquiry!.id);
  expect(stillNew?.status).toBe("NEW");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/services/commercial-inquiry.service.test.ts`
Expected: FAIL — `resolvePartyIdFromGuess` still calls the now-removed `findByName`
(compile/runtime error), and even once that's fixed to call `listByName`, ambiguity isn't
detected yet.

- [ ] **Step 4: Update `resolvePartyIdFromGuess`**

Read the current content of `src/services/commercial-inquiry.service.ts` in full first —
`resolvePartyIdFromGuess`'s `repo` parameter type currently declares a `findByName` method
matching the old single-row signature; this must change to `listByName` returning an array.

```typescript
// src/services/commercial-inquiry.service.ts
// Add to the existing import from "@/domain/commercial-flow/errors":
import {
  InquiryAlreadyResolvedError,
  InquiryNotFoundError,
  AmbiguousPartyGuessError,
} from "@/domain/commercial-flow/errors";

// Replace resolvePartyIdFromGuess's body and its `repo` parameter type:
async function resolvePartyIdFromGuess(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  explicitId: string | null | undefined,
  guess: string | null,
  repo: {
    listByName: (
      db: NodePgDatabase<typeof schema>,
      organizationId: string,
      name: string,
    ) => Promise<{ id: string }[]>;
    create: (
      db: NodePgDatabase<typeof schema>,
      organizationId: string,
      input: { name: string },
    ) => Promise<{ id: string }>;
  },
): Promise<string | null> {
  if (explicitId !== undefined) return explicitId;
  if (!guess) return null;

  const matches = await repo.listByName(tx, organizationId, guess);
  if (matches.length > 1) {
    throw new AmbiguousPartyGuessError(guess);
  }
  if (matches.length === 1) {
    return matches[0]!.id;
  }

  const created = await repo.create(tx, organizationId, { name: guess });
  return created.id;
}
```

The two call sites of `resolvePartyIdFromGuess` inside `resolve()` (one for `companyId` with
`CompaniesRepository`, one for `brandId` with `BrandsRepository`) don't need any change —
they already pass the whole repository object, and both `CompaniesRepository` and
`BrandsRepository` now have `listByName` (Task 1) satisfying the updated parameter type.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/services/commercial-inquiry.service.test.ts`
Expected: PASS — including every pre-existing test in this file (the "resolves a new company"
test and others use an explicit `companyId`, so `explicitId !== undefined` short-circuits
before `listByName` is ever called for them; only guess-based resolution paths exercise the
new logic).

- [ ] **Step 6: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/domain/commercial-flow/errors.ts src/services/commercial-inquiry.service.ts src/services/commercial-inquiry.service.test.ts
git commit -m "feat: detect ambiguous company/brand name guesses in CommercialInquiryService.resolve"
```

---

### Task 3: Error mapping on `POST /api/commercial-inquiries/[id]/convert`

**Files:**
- Modify: `src/app/api/commercial-inquiries/[id]/convert/route.ts`
- Test: `src/app/api/commercial-inquiries/[id]/convert/route.test.ts`

**Interfaces:**
- Consumes: `CommercialInquiryService.resolve` (unchanged signature), `InquiryNotFoundError`,
  `InquiryAlreadyResolvedError`, `AmbiguousPartyGuessError` (Task 2) from
  `src/domain/commercial-flow/errors.ts`.
- Produces: `POST /api/commercial-inquiries/:id/convert` now returns `404`
  (`InquiryNotFoundError`), `409` (`InquiryAlreadyResolvedError`), or `422`
  (`AmbiguousPartyGuessError`) instead of an unmapped `500` for these three cases.

- [ ] **Step 1: Write the failing route test**

`src/app/api/commercial-inquiries/[id]/convert/route.test.ts` doesn't exist yet — create it.
Reuse the fixture pattern from
`src/app/api/commercial-inquiries/[id]/mark-false-positive/route.test.ts` (a
`setupOrgCreatorAndInquiry` helper using `InboxService.ingestManualMessage`) — read that file
first for the exact helper shape to mirror, then add the ambiguity-specific setup this test
needs:

```typescript
// src/app/api/commercial-inquiries/[id]/convert/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { InboxService } from "@/services/inbox.service";
import { runInTenantContext } from "@/repositories/tenant-context";
import { companies } from "@/db/schema/companies-brands-contacts";

function fakeAI() {
  return {
    classifyMessage: async () => ({
      category: "COMMERCIAL_LEAD" as const,
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
  };
}

async function setupOrgCreatorAndInquiry(db: Awaited<ReturnType<typeof withTestDb>>["db"]) {
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
  const { inquiry } = await InboxService.ingestManualMessage(db, fakeAI(), organization.id, {
    creatorId: creator.id,
    source: "INSTAGRAM",
    externalContactLabel: "Maria — Bella Cosméticos",
    body: "Olá, gostaríamos de saber os valores.",
    receivedAt: new Date(),
  });
  return { organization, creator, inquiry: inquiry! };
}

describe("POST /api/commercial-inquiries/:id/convert", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 and converts the inquiry when given an explicit companyId", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.doMock("@/db", () => ({ db }));

    const { organization, inquiry } = await setupOrgCreatorAndInquiry(db);
    const [company] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }).returning(),
    );

    const { POST } = await import("./route");
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        contact: { fullName: "Maria" },
        companyId: company.id,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(200);
  });

  it("returns 404 when the inquiry does not exist for that organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.doMock("@/db", () => ({ db }));

    const { organization } = await setupOrgCreatorAndInquiry(db);

    const { POST } = await import("./route");
    const nonexistentId = "00000000-0000-0000-0000-000000000000";
    const request = new Request(`http://localhost/api/commercial-inquiries/${nonexistentId}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: organization.id, contact: { fullName: "Maria" } }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: nonexistentId }) });
    expect(response.status).toBe(404);
  });

  it("returns 409 when the inquiry is already resolved", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.doMock("@/db", () => ({ db }));

    const { organization, inquiry } = await setupOrgCreatorAndInquiry(db);
    const { CommercialInquiryService } = await import("@/services/commercial-inquiry.service");
    await CommercialInquiryService.discard(db, organization.id, inquiry.id);

    const { POST } = await import("./route");
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: organization.id, contact: { fullName: "Maria" } }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(409);
  });

  it("returns 422 when the company guess matches more than one existing company", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.doMock("@/db", () => ({ db }));

    const { organization, inquiry } = await setupOrgCreatorAndInquiry(db);
    await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }),
    );
    await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }),
    );

    const { POST } = await import("./route");
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // companyId omitted -- forces guess-based resolution, which is now ambiguous.
      body: JSON.stringify({ organizationId: organization.id, contact: { fullName: "Maria" } }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run "src/app/api/commercial-inquiries/[id]/convert/route.test.ts"`
Expected: FAIL on the 404/409/422 cases — the route currently has no error mapping, so those
requests throw unhandled and surface as `500`, not the expected status codes. (The 200 case
should already pass, since it exercises the route's existing success path.)

- [ ] **Step 3: Add error mapping to the route**

Read the current content of `src/app/api/commercial-inquiries/[id]/convert/route.ts` first.

```typescript
// src/app/api/commercial-inquiries/[id]/convert/route.ts
// Add this import:
import {
  InquiryNotFoundError,
  InquiryAlreadyResolvedError,
  AmbiguousPartyGuessError,
} from "@/domain/commercial-flow/errors";

// Wrap the existing body of the POST handler in try/catch:
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());

  try {
    const result = await CommercialInquiryService.resolve(db, payload.organizationId, id, {
      contact: payload.contact,
      companyId: payload.companyId,
      brandId: payload.brandId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof InquiryNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof InquiryAlreadyResolvedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof AmbiguousPartyGuessError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run "src/app/api/commercial-inquiries/[id]/convert/route.test.ts"`
Expected: PASS (all 4 cases: 200, 404, 409, 422).

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add "src/app/api/commercial-inquiries/[id]/convert"
git commit -m "feat: map domain errors to HTTP status on POST /api/commercial-inquiries/:id/convert"
```

---

## Self-Review

**Spec coverage:**
- Decisão #1 (`listByName` replacing `findByName`) — Task 1.
- Decisão #2 (0/1/many resolution logic) — Task 2.
- Decisão #3 (`AmbiguousPartyGuessError`) — Task 2, Step 1.
- Decisão #4 (route error mapping, scoped to exactly these 3 errors) — Task 3.
- §3 "fora de escopo" (no fuzzy matching, no schema constraint, no UI) — no task introduces
  any of these.

**Placeholder scan:** none — every step has literal code or an exact runnable test command.

**Type consistency:** `resolvePartyIdFromGuess`'s `repo` parameter type in Task 2 requires
`listByName` with the exact signature Task 1 produces
(`(db, organizationId, name) => Promise<{id: string}[]>` — a structural supertype of both
`Company[]` and `Brand[]`, which both satisfy it since both types include `id: string`).
`AmbiguousPartyGuessError` is defined once (Task 2, Step 1) and imported by name (not
redefined) in both the service (Task 2, Step 4) and the route (Task 3, Step 3).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-ambiguous-party-guess.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
