# CREATOR Role Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session with role CREATOR may:
- read only its own creator's data;
- register inbox messages for itself;
- share already-sent proposals;
- receive only its own notifications.

Everything else is 403, or 404 for another creator's records. The UI hides what the role can't do.

**Architecture:**
- **Session:** carries `creatorId` (the CREATOR's own creator, or `null` for OWNER/MANAGER).
- **Access helpers** (`src/lib/auth/access.ts`): deny CREATOR writes by default and derive a `creatorScope`.
- **Scope-aware repositories** (defense in depth):
  - `OpportunitiesRepository.findById`, `ProposalsRepository.findById` and `CommercialInquiriesRepository.findById` accept an optional `creatorScope` and filter in SQL;
  - `ProposalsRepository.creatorIdForProposal` derives a proposal's owner from its opportunity. Every proposal-tree route (blocks, items, versions, publications, send-state, share-info) checks scope through it.
- **Routes:** apply the rules in a fixed order.
- **Notifications:** the fan-out filters CREATOR members to the proposal's owner.
- **Client:** gets the role via a `SessionRoleProvider`, trims the creator payload, and renders read-only variants.

**Tech Stack:** Next.js 16 (route handlers, App Router, `notFound`, `redirect`), React 19, TanStack Query, Drizzle + Postgres, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-29-creator-role-permissions-design.md`

## Global Constraints

- **Next.js docs:** Next.js 16 — read `node_modules/next/dist/docs/` before changing routes, layouts or pages (AGENTS.md).
- **Session:** `Session = { userId; organizationId; role: "OWNER" | "MANAGER" | "CREATOR"; creatorId: string | null }`.
  - `creatorId` is non-null iff role is CREATOR.
  - A CREATOR member without a creator row in the org gets **no session** (`null`).
- **403 body:** `{ "error": "Sem permissão." }` (`forbiddenResponse()` from `src/lib/auth/http.ts`).
- **Route check order:** session (401) → `isUuid` (404) → CREATOR write (403) → scope (404, or 403 for org CRM) → body (400) → the rest.
- **CREATOR write exceptions** (all other POST/PATCH/PUT/DELETE → 403 for CREATOR):
  - `POST /api/inbox/messages`: the body's `creatorId` is ignored for CREATOR and `session.creatorId` is used;
  - `PATCH /api/notifications/[id]`;
  - `POST /api/notifications/read-all`.
- **Another creator's record → 404** with the route's own not-found body.
- **Org CRM GET → 403 for CREATOR:** companies, companies/[id], contacts, contacts/[id], brands, leads, leads/[id], rate-cards, rate-card-items, services.
- **`GET /api/creators` for CREATOR:** exactly `[{ id, displayName, instagramHandle }]` of its own creator.
- **Notification fan-out:**
  - OWNER and MANAGER members always receive;
  - a CREATOR member receives only when its user is the owning creator's `creators.user_id`.
- **UI copy:** unchanged strings; the creator form's general error uses `role="alert"` with `error.message`.
- **Proposal read view:** the iframe title is exactly `Apresentação da proposta`.
- **DB:** no migration; implementers never touch a DB outside the Vitest suite.
- **Commands:**
  - pnpm: `/opt/homebrew/bin/pnpm`;
  - full suite: `/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000`;
  - build: `OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build`;
  - run everything in the foreground.
- **Commits:** end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, whatever model you are.
- **Worktree shell:** run plain single commands; quote paths with `[id]`, `(app)`, `(preview)`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/auth/types.ts`, `resolve-session.ts` | `creatorId` on the session |
| `src/lib/auth/access.ts` | `creatorScope`, `isCreator`, `denyCreatorWrite`, `canManageOrganization` |
| `src/test/helpers/route.ts` | `ownerSession` (creatorId null), new `creatorSession` |
| `src/test/helpers/two-creators.ts` | fixture: one org, creators X and Y each with an opportunity and a proposal |
| `src/repositories/{opportunities,proposals,commercial-inquiries,creators}.repository.ts` | scope-aware reads and `creatorIdForProposal` |
| ~30 `src/app/api/**/route.ts` files | the rules |
| `src/app/api/creator-access.test.ts` | table-driven CREATOR test |
| `src/repositories/notifications.repository.ts`, `src/services/event-handlers/proposal-notifications.ts` | filtered fan-out |
| `src/components/shell/session-role-context.tsx` | `SessionRoleProvider` / `useSessionRole` |
| layout, sidebar, switcher, `/creators` page, creator form | CREATOR navigation |
| pipeline board and panel, inbox panel, proposal page, `src/components/proposals/proposal-read-view.tsx` | read-only views |

---

### Task 1: Session `creatorId` and access helpers

**Files:**
- Modify: `src/lib/auth/types.ts`, `src/lib/auth/resolve-session.ts`, `src/lib/auth/resolve-session.test.ts`, `src/lib/auth/http.ts`, `src/repositories/creators.repository.ts`, `src/test/helpers/route.ts`, `src/app/api/creators/route.ts`, `src/app/api/creators/[id]/route.ts`
- Create: `src/lib/auth/access.ts`, `src/lib/auth/access.test.ts`
- Fix any compile errors elsewhere caused by the new required `creatorId` field (test files that build `Session` literals). Use `ownerSession(...)` or add `creatorId: null`.

**Interfaces:**
- Produces:
  - `Session.creatorId: string | null`;
  - `CreatorsRepository.findByUserId(db, organizationId, userId): Promise<Creator | null>` (runs in tenant context);
  - `creatorScope(session: Session): string | null`;
  - `isCreator(session: Session): boolean`;
  - `denyCreatorWrite(session: Session): NextResponse | null`;
  - `canManageOrganization(role: SessionRole): boolean` (replaces `canManageCreators`; update its two call sites and remove the old export);
  - `creatorSession(organizationId: string, userId: string, creatorId: string): Session` in `src/test/helpers/route.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/auth/access.test.ts
import { describe, it, expect } from "vitest";
import { canManageOrganization, creatorScope, denyCreatorWrite, isCreator } from "./access";

const owner = { userId: "u", organizationId: "o", role: "OWNER" as const, creatorId: null };
const creator = { userId: "u", organizationId: "o", role: "CREATOR" as const, creatorId: "c1" };

describe("access helpers", () => {
  it("scope is the creator's id only for CREATOR", () => {
    expect(creatorScope(owner)).toBeNull();
    expect(creatorScope({ ...owner, role: "MANAGER" })).toBeNull();
    expect(creatorScope(creator)).toBe("c1");
  });

  it("isCreator / canManageOrganization", () => {
    expect(isCreator(creator)).toBe(true);
    expect(isCreator(owner)).toBe(false);
    expect(canManageOrganization("OWNER")).toBe(true);
    expect(canManageOrganization("MANAGER")).toBe(true);
    expect(canManageOrganization("CREATOR")).toBe(false);
  });

  it("denyCreatorWrite returns a 403 for CREATOR only", async () => {
    expect(denyCreatorWrite(owner)).toBeNull();
    const response = denyCreatorWrite(creator)!;
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Sem permissão." });
  });
});
```

Add to `src/lib/auth/resolve-session.test.ts`, following its existing setup (read the file; it builds users, organizations and memberships with the test DB):

```typescript
  it("OWNER and MANAGER get creatorId null", async () => {
    // Use the file's existing linked-owner setup; assert the resolved session has creatorId: null.
  });

  it("a CREATOR member with a creator row gets its creatorId", async () => {
    // Create an org, a users row linked to authUser.id, an organization_members row with role "CREATOR",
    // and a creator via CreatorService.register(db, orgId, { fullName, displayName, email: <same e-mail>, instagramHandle: null }).
    // Expect resolveSessionForAuthUser(...) toEqual({ userId, organizationId, role: "CREATOR", creatorId: creator.id }).
  });

  it("a CREATOR member without a creator row gets no session", async () => {
    // Same as above without registering the creator → expect null.
  });
```

Write these three cases with the file's real fixtures and helpers. The expectations in the comments are the contract.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/auth`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `src/lib/auth/types.ts`: add `creatorId: string | null;` to `Session`.
- `CreatorsRepository.findByUserId(db, organizationId, userId)`: `runInTenantContext(db, organizationId, (tx) => this.findByUserIdWithTx(tx, organizationId, userId))`. Use the object's existing method; if `this` isn't usable in the object literal pattern, call `CreatorsRepository.findByUserIdWithTx`.
- `resolve-session.ts`, after resolving the membership:

```typescript
  if (membership.role === "CREATOR") {
    const creator = await CreatorsRepository.findByUserId(db, membership.organizationId, user.id);
    if (!creator) return null;
    return { userId: user.id, organizationId: membership.organizationId, role: "CREATOR", creatorId: creator.id };
  }
  return { userId: user.id, organizationId: membership.organizationId, role: membership.role, creatorId: null };
```

- `src/lib/auth/access.ts`:

```typescript
import type { NextResponse } from "next/server";
import { forbiddenResponse } from "./http";
import type { Session, SessionRole } from "./types";

/** OWNER/MANAGER: null (no restriction). CREATOR: its own creator id. */
export function creatorScope(session: Session): string | null {
  return session.role === "CREATOR" ? session.creatorId : null;
}

export function isCreator(session: Session): boolean {
  return session.role === "CREATOR";
}

/** Writes are denied to CREATOR by default; allowed exceptions simply don't call this. */
export function denyCreatorWrite(session: Session): NextResponse | null {
  return isCreator(session) ? forbiddenResponse() : null;
}

/** Agency-side management (creators, CRM). */
export function canManageOrganization(role: SessionRole): boolean {
  return role === "OWNER" || role === "MANAGER";
}
```

- `src/lib/auth/http.ts`: remove `canManageCreators` and update `src/app/api/creators/route.ts` and `src/app/api/creators/[id]/route.ts` to use `canManageOrganization`.
- `src/test/helpers/route.ts`: `ownerSession` returns `{ organizationId, userId, role: "OWNER", creatorId: null }`, plus:

```typescript
export function creatorSession(organizationId: string, userId: string, creatorId: string): Session {
  return { organizationId, userId, role: "CREATOR", creatorId };
}
```

- Run `/opt/homebrew/bin/pnpm exec tsc --noEmit -p .` and fix every `Session` literal missing `creatorId`, typically in tests spreading `ownerSession(...)` with `role: "CREATOR"`. Keep those tests' intent: where they meant a CREATOR, add `creatorId: "00000000-0000-4000-8000-0000000000c1"`.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/lib/auth src/app/api/creators
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add -A src
git commit -m "feat: session carries the CREATOR's creatorId; access helpers"
```

---

### Task 2: Scope-aware repositories and the two-creators fixture

**Files:**
- Modify: `src/repositories/opportunities.repository.ts`, `src/repositories/proposals.repository.ts`, `src/repositories/commercial-inquiries.repository.ts`
- Create: `src/test/helpers/two-creators.ts`, `src/repositories/creator-scope.test.ts`

**Interfaces:**
- Consumes: `CreatorService.register` (spec A), `seedProposal`-style inserts.
- Produces:
  - `OpportunitiesRepository.findById(db, orgId, id, creatorScope: string | null = null)`: with a scope, returns `null` unless `opportunities.creator_id = scope`;
  - `ProposalsRepository.findById(db, orgId, id, creatorScope: string | null = null)`: with a scope, returns `null` unless the proposal's opportunity has `creator_id = scope` (SQL join or `exists` subquery);
  - `ProposalsRepository.creatorIdForProposal(db, orgId, proposalId): Promise<string | null>` (the opportunity's `creator_id`, or `null` when the proposal doesn't exist in the org);
  - `ProposalsRepository.isInCreatorScope(db, orgId, proposalId, creatorScope: string | null): Promise<boolean>` (`true` when the scope is null and the proposal exists in the org, or when `creatorIdForProposal === scope`);
  - `CommercialInquiriesRepository.findById(db, orgId, id, creatorScope: string | null = null)`: with a scope, returns `null` unless `commercial_inquiries.creator_id = scope`;
  - `CommercialInquiriesRepository.isInCreatorScope(db, orgId, inquiryId, creatorScope): Promise<boolean>`;
  - fixture `seedTwoCreators(db): Promise<{ organization; owner; x: { creator; user; opportunity; proposal }; y: { creator; user; opportunity; proposal } }>`.

- [ ] **Step 1: Write the fixture and failing tests**

```typescript
// src/test/helpers/two-creators.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ProposalService } from "@/services/proposal.service";
import { companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { users } from "@/db/schema/organizations";

let counter = 0;

/** One organization with two creators (X and Y), each owning an opportunity and a proposal. */
export async function seedTwoCreators(db: NodePgDatabase<typeof schema>) {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  const { organization, owner } = await OrganizationService.createWithOwner(db, {
    organizationName: `Org ${suffix}`,
    ownerEmail: `owner-${suffix}@publyflow.test`,
    ownerFullName: "Owner",
  });

  async function seedCreator(name: string) {
    const creator = await CreatorService.register(db, organization.id, {
      fullName: name,
      displayName: name,
      email: `${name.toLowerCase()}-${suffix}@publyflow.test`,
      instagramHandle: null,
    });
    const [user] = await db.select().from(users).where(eq(users.id, creator.userId));
    const [company] = await db.insert(companies).values({ organizationId: organization.id, name: `Marca ${name}` }).returning();
    const [contact] = await db.insert(contacts).values({ organizationId: organization.id, companyId: company.id, fullName: `Contato ${name}` }).returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, companyId: company.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: organization.id, creatorId: creator.id, leadId: lead.id, companyId: company.id, brandId: null })
      .returning();
    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: `Proposta ${name}`,
      theme: "PREMIUM",
      userId: owner.id,
    });
    return { creator, user, opportunity, proposal };
  }

  const x = await seedCreator("Xavier");
  const y = await seedCreator("Yara");
  return { organization, owner, x, y };
}
```

(Check `src/test/helpers/proposal-fixtures.ts` for the exact insert shapes and imports and mirror them.)

```typescript
// src/repositories/creator-scope.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedTwoCreators } from "@/test/helpers/two-creators";
import { OpportunitiesRepository } from "./opportunities.repository";
import { ProposalsRepository } from "./proposals.repository";

describe("creator scope in repositories", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("opportunities: scoped findById hides other creators", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, x, y } = await seedTwoCreators(db);
    expect(await OpportunitiesRepository.findById(db, organization.id, y.opportunity.id)).not.toBeNull();
    expect(await OpportunitiesRepository.findById(db, organization.id, y.opportunity.id, x.creator.id)).toBeNull();
    expect((await OpportunitiesRepository.findById(db, organization.id, x.opportunity.id, x.creator.id))?.id).toBe(x.opportunity.id);
  });

  it("proposals: owner derives from the opportunity; scoped findById and isInCreatorScope", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, x, y } = await seedTwoCreators(db);
    expect(await ProposalsRepository.creatorIdForProposal(db, organization.id, y.proposal.id)).toBe(y.creator.id);
    expect(await ProposalsRepository.creatorIdForProposal(db, organization.id, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await ProposalsRepository.findById(db, organization.id, y.proposal.id, x.creator.id)).toBeNull();
    expect((await ProposalsRepository.findById(db, organization.id, x.proposal.id, x.creator.id))?.id).toBe(x.proposal.id);
    expect(await ProposalsRepository.isInCreatorScope(db, organization.id, y.proposal.id, x.creator.id)).toBe(false);
    expect(await ProposalsRepository.isInCreatorScope(db, organization.id, y.proposal.id, null)).toBe(true);
    expect(await ProposalsRepository.isInCreatorScope(db, organization.id, x.proposal.id, x.creator.id)).toBe(true);
  });
});
```

Add a commercial-inquiries case: create one inquiry per creator (use `InboxService.ingestManualMessage` with a fake AI returning `COMMERCIAL_LEAD`, as `src/services/inbox.service.test.ts` does). Assert that the scoped `findById` hides Y's inquiry from X, and that `isInCreatorScope` matches.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/repositories/creator-scope.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the optional last parameter `creatorScope: string | null = null` to the three `findById` methods:
- add `eq(<table>.creatorId, creatorScope)` to the `where` when it is non-null;
- for proposals, use `and(..., exists(select 1 from opportunities where opportunities.id = proposals.opportunity_id and opportunities.creator_id = scope))`, or an inner join on opportunities selecting only the proposal columns.

Existing callers are unaffected, because the default is `null`. Implement `creatorIdForProposal`: select `opportunities.creatorId` from `proposals` inner join `opportunities` on `opportunities.id = proposals.opportunityId`, where `proposals.id` and `proposals.organizationId` match, inside `runInTenantContext`. `isInCreatorScope`:

```typescript
  async isInCreatorScope(db, organizationId, proposalId, creatorScope) {
    const owner = await ProposalsRepository.creatorIdForProposal(db, organizationId, proposalId);
    if (owner === null) return false;
    return creatorScope === null || owner === creatorScope;
  },
```

Mirror this for `CommercialInquiriesRepository.isInCreatorScope`, using the inquiry's own `creatorId`.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/repositories
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/repositories src/test/helpers/two-creators.ts
git commit -m "feat: creator scope in opportunity, proposal and inquiry repositories"
```

---

### Task 3: Route rules for CREATOR

**Files:**
- Modify: the route files in the table below
- Modify: `src/app/(preview)/proposals/[id]/preview/page.tsx`
- Create: `src/app/api/creator-access.test.ts`

**Interfaces:**
- Consumes: `creatorScope`, `denyCreatorWrite`, `isCreator`, `canManageOrganization`, `forbiddenResponse` (Task 1); `ProposalsRepository.isInCreatorScope`, `CommercialInquiriesRepository.isInCreatorScope`, `OpportunitiesRepository.findById(..., scope)` (Task 2); `creatorSession`, `seedTwoCreators`.
- Produces: nothing new.

Rules table. "deny" = insert `const denied = denyCreatorWrite(session); if (denied) return denied;` after the session check and the `isUuid` guard. "scope-proposal" = insert, after the `isUuid` guard:

```typescript
  const scope = creatorScope(session);
  if (scope !== null && !(await ProposalsRepository.isInCreatorScope(db, session.organizationId, id, scope))) {
    return <this route's existing not-found response>;
  }
```

"crm" = insert `if (!canManageOrganization(session.role)) return forbiddenResponse();` after the session check.

| Route (under `src/app/api/`) | Method | Rule |
|---|---|---|
| `proposals/route.ts` | POST | deny |
| `proposals/route.ts` | GET (list by opportunity) | if `creatorScope` is set, 404-equivalent empty result when the opportunity isn't in scope: check `OpportunitiesRepository.findById(db, org, opportunityId, scope)`; if null return `[]` with 200 |
| `proposals/[id]/route.ts` | GET | scope-proposal |
| `proposals/[id]/route.ts` | PATCH | deny |
| `proposals/[id]/blocks/route.ts` | GET | scope-proposal |
| `proposals/[id]/blocks/route.ts` | POST | deny |
| `proposals/[id]/items/route.ts` | GET | scope-proposal |
| `proposals/[id]/items/route.ts` | POST | deny |
| `proposals/[id]/versions/route.ts` | GET | scope-proposal |
| `proposals/[id]/publications/route.ts` | POST | deny |
| `proposals/[id]/publications/route.ts` | GET | scope-proposal |
| `proposals/[id]/send-state/route.ts` | GET | scope-proposal |
| `proposals/[id]/share-info/route.ts` | GET | scope-proposal |
| `proposal-blocks/[id]/route.ts` | PATCH, DELETE | deny |
| `proposal-items/[id]/route.ts` | PATCH, DELETE | deny |
| `opportunities/route.ts` | GET | for CREATOR, replace the query `creatorId` with `session.creatorId` before calling the service |
| `opportunities/[id]/route.ts` | GET | pass `creatorScope(session)` to the lookup (`OpportunitiesRepository.findById(..., scope)` directly, or through the service if it wraps it; add the param to the service method); null → the route's 404 |
| `opportunities/[id]/route.ts` | PATCH | deny |
| `commercial-inquiries/route.ts` | GET | for CREATOR, replace the query `creatorId` with `session.creatorId` |
| `commercial-inquiries/[id]/convert/route.ts`, `discard/route.ts`, `mark-false-positive/route.ts` | POST | deny |
| `inbox/messages/route.ts` | POST | allowed; for CREATOR use `creatorId: session.creatorId!` instead of `payload.creatorId` |
| `notifications/[id]/route.ts`, `notifications/read-all/route.ts` | PATCH, POST | unchanged (allowed) |
| `companies/route.ts`, `companies/[id]/route.ts`, `contacts/route.ts`, `contacts/[id]/route.ts`, `brands/route.ts`, `leads/route.ts`, `leads/[id]/route.ts`, `rate-cards/route.ts` (GET), `rate-card-items/route.ts`, `services/route.ts` (GET) | GET | crm |
| `rate-cards/route.ts`, `services/route.ts` | POST | deny |
| `rate-cards/[id]/duplicate/route.ts`, `rate-cards/[id]/items/route.ts` | POST | deny |
| `rate-card-items/[id]/route.ts` | PATCH, DELETE | deny |
| `services/[id]/route.ts` | PATCH | deny |
| `creators/route.ts` | GET | for CREATOR, return `[{ id, displayName, instagramHandle }]` of the creator whose id is `session.creatorId` (take it from `CreatorService.listByOrganization` filtered by id) |
| `creators/route.ts`, `creators/[id]/route.ts` | POST, PATCH | already 403 via `canManageOrganization` |

For every route, read the file first and check any not-found body against the file itself. Keep the check order from the Global Constraints.

Preview page (`src/app/(preview)/proposals/[id]/preview/page.tsx`): after the session and `isUuid` checks, add `if (session.role === "CREATOR" && !(await ProposalsRepository.isInCreatorScope(db, session.organizationId, id, session.creatorId))) notFound();`. Use the page's own session variable. If it uses `requireAppSession()`, that returns a `Session` with `creatorId`.

- [ ] **Step 1: Write the failing table-driven test**

```typescript
// src/app/api/creator-access.test.ts
import { describe, it, expect, afterAll, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, creatorSession } from "@/test/helpers/route";
import { seedTwoCreators } from "@/test/helpers/two-creators";

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

describe("CREATOR access rules", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterAll(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedTwoCreators(db);
    const session = creatorSession(seeded.organization.id, seeded.x.user.id, seeded.x.creator.id);
    const call = async (load: () => Promise<Record<string, unknown>>, method: string, url: string, params: Record<string, string> = {}, body?: unknown) => {
      const handlers = await importRouteWithSession(load, {
        db,
        session,
        extraMocks: () => {
          vi.doMock("@/lib/ai", () => ({
            ai: {
              classifyMessage: async () => ({
                category: "COMMERCIAL_LEAD",
                commercialScore: 90,
                intent: null,
                extracted: { companyName: null, brandName: null, contactName: null, email: null, phone: null, budget: null, deliverables: null },
              }),
            },
          }));
        },
      });
      const init: RequestInit = { method };
      if (body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      return (handlers[method] as Handler)(new Request(`http://localhost${url}`, init), { params: Promise.resolve(params) });
    };
    return { db, ...seeded, call };
  }

  it("denies writes with 403", async () => {
    const { x, call } = await setup();
    const p = x.proposal.id;
    const cases: Array<[() => Promise<Record<string, unknown>>, string, string, Record<string, string>]> = [
      [() => import("./proposals/route"), "POST", "/api/proposals", {}],
      [() => import("./proposals/[id]/route"), "PATCH", `/api/proposals/${p}`, { id: p }],
      [() => import("./proposals/[id]/blocks/route"), "POST", `/api/proposals/${p}/blocks`, { id: p }],
      [() => import("./proposals/[id]/items/route"), "POST", `/api/proposals/${p}/items`, { id: p }],
      [() => import("./proposals/[id]/publications/route"), "POST", `/api/proposals/${p}/publications`, { id: p }],
      [() => import("./opportunities/[id]/route"), "PATCH", `/api/opportunities/${x.opportunity.id}`, { id: x.opportunity.id }],
      [() => import("./rate-cards/route"), "POST", "/api/rate-cards", {}],
      [() => import("./services/route"), "POST", "/api/services", {}],
    ];
    for (const [load, method, url, params] of cases) {
      const response = await call(load, method, url, params, {});
      expect(response.status, `${method} ${url}`).toBe(403);
      expect(await response.json()).toEqual({ error: "Sem permissão." });
    }
  });

  it("404 for another creator's proposal and opportunity, 200 for its own", async () => {
    const { x, y, call } = await setup();
    for (const [load, suffix] of [
      [() => import("./proposals/[id]/route"), ""],
      [() => import("./proposals/[id]/blocks/route"), "/blocks"],
      [() => import("./proposals/[id]/items/route"), "/items"],
      [() => import("./proposals/[id]/versions/route"), "/versions"],
      [() => import("./proposals/[id]/publications/route"), "/publications"],
      [() => import("./proposals/[id]/send-state/route"), "/send-state"],
      [() => import("./proposals/[id]/share-info/route"), "/share-info"],
    ] as const) {
      expect((await call(load, "GET", `/api/proposals/${y.proposal.id}${suffix}`, { id: y.proposal.id })).status, `Y ${suffix}`).toBe(404);
      expect((await call(load, "GET", `/api/proposals/${x.proposal.id}${suffix}`, { id: x.proposal.id })).status, `X ${suffix}`).toBe(200);
    }
    const opp = () => import("./opportunities/[id]/route");
    expect((await call(opp, "GET", `/api/opportunities/${y.opportunity.id}`, { id: y.opportunity.id })).status).toBe(404);
    expect((await call(opp, "GET", `/api/opportunities/${x.opportunity.id}`, { id: x.opportunity.id })).status).toBe(200);
  });

  it("lists are forced to the session's creator", async () => {
    const { x, y, call } = await setup();
    const list = await call(() => import("./opportunities/route"), "GET", `/api/opportunities?creatorId=${y.creator.id}`);
    expect(list.status).toBe(200);
    const items = (await list.json()) as Array<{ id: string }>;
    expect(items.map((item) => item.id)).toEqual([x.opportunity.id]);
  });

  it("org CRM lists are 403", async () => {
    const { call } = await setup();
    for (const [load, url] of [
      [() => import("./companies/route"), "/api/companies"],
      [() => import("./contacts/route"), "/api/contacts"],
      [() => import("./brands/route"), "/api/brands"],
      [() => import("./leads/route"), "/api/leads"],
    ] as const) {
      expect((await call(load, "GET", url)).status, url).toBe(403);
    }
  });

  it("inbox message is created for the session's creator even if the body says otherwise", async () => {
    const { x, y, call } = await setup();
    const response = await call(() => import("./inbox/messages/route"), "POST", "/api/inbox/messages", {}, {
      creatorId: y.creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Joana",
      body: "Queremos uma proposta.",
    });
    expect(response.status).toBe(201);
    expect((await response.json()).inquiry.creatorId).toBe(x.creator.id);
  });

  it("GET /api/creators returns only its own creator without e-mail", async () => {
    const { x, call } = await setup();
    const response = await call(() => import("./creators/route"), "GET", "/api/creators");
    expect(await response.json()).toEqual([{ id: x.creator.id, displayName: x.creator.displayName, instagramHandle: x.creator.instagramHandle }]);
  });
});
```

The opportunities list route may read its query param under a different name, or return a different shape. Read the route and adapt only the URL and the extraction; keep the assertion that only X's opportunity comes back. Likewise, check the inbox response shape (`inquiry.creatorId`) against the route. Existing route tests (OWNER sessions) must keep passing.

- [ ] **Step 2: Run it to see it fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/app/api/creator-access.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the table**

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/app/api
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/app/api "src/app/(preview)"
git commit -m "feat: enforce CREATOR access rules on API routes and preview"
```

---

### Task 4: Notifications only for the owning creator

**Files:**
- Modify: `src/repositories/notifications.repository.ts`, `src/services/event-handlers/proposal-notifications.ts`
- Test: `src/services/event-handlers/proposal-notifications.test.ts` or `src/services/event-drain.service.test.ts` (add a case)

**Interfaces:**
- Consumes: `ProposalsRepository.creatorIdForProposal` (Task 2), `seedTwoCreators`.
- Produces: `NotificationsRepository.fanOutWithTx(tx, orgId, input, audience: { creatorUserId: string | null })`. It inserts for members with role OWNER or MANAGER, plus members with role CREATOR whose `user_id = audience.creatorUserId`.

- [ ] **Step 1: Write the failing test**

```typescript
  it("a response notifies OWNER/MANAGER and only the owning CREATOR", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, x, y } = await seedTwoCreators(db);
    await db.insert(organizationMembers).values([
      { organizationId: organization.id, userId: x.user.id, role: "CREATOR" },
      { organizationId: organization.id, userId: y.user.id, role: "CREATOR" },
    ]);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, y.proposal.id, owner.id);
    await ProposalResponseService.respond(db, publicPath.replace("/p/", ""), {
      publicationId: publication.id,
      action: "ACCEPT",
      name: "Maria",
      email: "maria@bella.test",
      message: null,
    });

    await EventDrainService.drain(db);

    const recipients = (await db.select().from(notifications)).map((n) => n.recipientUserId).sort();
    expect(recipients).toEqual([owner.id, y.user.id].sort());
  });
```

(Put it in `src/services/event-drain.service.test.ts`, importing `seedTwoCreators`, `organizationMembers`, `notifications`, `ProposalSendingService` and `ProposalResponseService`.)

- [ ] **Step 2: Run it to see it fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/services/event-drain.service.test.ts`
Expected: FAIL (X also receives it).

- [ ] **Step 3: Implement**

- `fanOutWithTx` gains the `audience` param. The members query becomes `where organization_id = org and (role in ('OWNER','MANAGER') or (role = 'CREATOR' and user_id = audience.creatorUserId))`, using drizzle `or`/`and`/`inArray`/`eq`. If `creatorUserId` is null, only OWNER and MANAGER.
- In `proposal-notifications.ts` `notify`, resolve the owner before fanning out:

```typescript
  const payload = event.payload as { proposal_id: string };
  const creatorId = await ProposalsRepository.creatorIdForProposal(tx, event.organizationId, payload.proposal_id);
  const [owner] = creatorId
    ? await tx.select({ userId: creators.userId }).from(creators).where(eq(creators.id, creatorId))
    : [];
  await NotificationsRepository.fanOutWithTx(tx, event.organizationId, { sourceEventId: event.id, ...copy }, { creatorUserId: owner?.userId ?? null });
```

`creatorIdForProposal` takes a db-like handle; the drain passes the transaction. Make sure it works with `tx`, since both are `NodePgDatabase`, and that it runs inside the drain's tenant context. Update the other `fanOutWithTx` callers (repository tests) to pass `{ creatorUserId: null }`.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/services src/repositories
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/services src/repositories
git commit -m "feat: notify only the owning creator among CREATOR members"
```

---

### Task 5: CREATOR navigation — role context, layout payload, sidebar, switcher, `/creators`, form error

**Files:**
- Create: `src/components/shell/session-role-context.tsx`, `src/components/shell/session-role-context.test.tsx`
- Modify: `src/app/(app)/layout.tsx`, `src/components/shell/sidebar.tsx` (+ test), `src/components/shell/creator-switcher.tsx` (+ test), `src/components/shell/creator-context.tsx` (type of `creators`), `src/app/(app)/creators/page.tsx` (+ test), `src/components/creators/creator-form-dialog.tsx` (+ test)

**Interfaces:**
- Consumes: `Session` (`role`, `creatorId`).
- Produces:
  - `SessionRoleProvider({ role, children })`;
  - `useSessionRole(): "OWNER" | "MANAGER" | "CREATOR"` (throws outside the provider);
  - `useIsCreator(): boolean`;
  - `CreatorContext` creators typed as `Array<{ id: string; displayName: string }>`.

- [ ] **Step 1: Write the failing tests**
  - **`session-role-context.test.tsx`:** `useIsCreator()` is true under `role="CREATOR"` and false under `role="OWNER"`.
  - **Sidebar:** under a CREATOR provider, the links are exactly Inbox, Pipeline and Proposals; under OWNER, all items including Creators.
  - **Switcher:** under CREATOR with `creators=[{ id: "c1", displayName: "Thais" }]`, it renders the text "Thais" and no button or menu (`queryByRole("button")` null).
  - **`/creators` page:** under CREATOR, it calls `router.replace("/pipeline")` and renders nothing. Mock `next/navigation`'s `useRouter` with `replace`.
  - **Creator form:** an `ApiError(403, "Sem permissão.", { error: "Sem permissão." })` renders `role="alert"` with "Sem permissão." and no error under E-mail. The 409 still goes under E-mail.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/components/shell src/components/creators "src/app/(app)/creators"`

- [ ] **Step 3: Implement**

```tsx
// src/components/shell/session-role-context.tsx
"use client";

import * as React from "react";
import type { SessionRole } from "@/lib/auth/types";

const SessionRoleContext = React.createContext<SessionRole | null>(null);

export function SessionRoleProvider({ role, children }: { role: SessionRole; children: React.ReactNode }) {
  return <SessionRoleContext.Provider value={role}>{children}</SessionRoleContext.Provider>;
}

export function useSessionRole(): SessionRole {
  const role = React.useContext(SessionRoleContext);
  if (!role) throw new Error("useSessionRole must be used within a SessionRoleProvider");
  return role;
}

export function useIsCreator(): boolean {
  return useSessionRole() === "CREATOR";
}
```

- **Layout:** wrap everything in `<SessionRoleProvider role={session.role}>`. Build the creators prop as `creators.filter((c) => session.role !== "CREATOR" || c.id === session.creatorId).map(({ id, displayName }) => ({ id, displayName }))`.
- **`creator-context.tsx`:** type the prop as `Array<{ id: string; displayName: string }>`; nothing else changes.
- **Sidebar:** `const isCreator = useIsCreator();` and filter the items to Inbox, Pipeline and Proposals when true. Match by `href`: `/inbox`, `/pipeline`, `/proposals`. Keep `SIDEBAR_NAV_ITEMS` exported as is. Any existing test rendering the sidebar must now wrap it in `SessionRoleProvider role="OWNER"`; update those tests.
- **Switcher:** if `useIsCreator()`, return `<span className="text-sm font-medium">{creators[0]?.displayName ?? ""}</span>`. Wrap existing switcher tests in an OWNER provider.
- **`/creators` page:** at the top, `const isCreator = useIsCreator(); const router = useRouter(); React.useEffect(() => { if (isCreator) router.replace("/pipeline"); }, [isCreator, router]); if (isCreator) return null;` (Hooks before any return. `useCreators` may still be declared; guard its render.) Update the page test's mocks to provide the role.
- **Creator form:** in `toFieldErrors`, for an `ApiError` that isn't 409 and has no `errors` body, return a form-level error instead of an e-mail field error. Add `const [formError, setFormError] = React.useState<string | null>(null)`, rendered above the submit button as `<p role="alert" className="text-sm text-error">{formError}</p>`. Non-`ApiError` errors show `Não foi possível salvar. Tente novamente.` as the form error.

Any other component test that now renders under the layout or uses `useSessionRole` without a provider will throw. Find them with the full suite and wrap them in `SessionRoleProvider role="OWNER"`.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/components "src/app/(app)"
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add -A src
git commit -m "feat: CREATOR navigation and trimmed creator payload"
```

---

### Task 6: CREATOR read-only screens — Pipeline, Inbox, Proposal

**Files:**
- Modify: `src/app/(app)/pipeline/page.tsx`, `src/components/pipeline/pipeline-board-desktop.tsx`, `src/components/pipeline/pipeline-board-mobile.tsx`, `src/components/pipeline/opportunity-side-panel.tsx`, `src/app/(app)/inbox/page.tsx` or `src/components/inbox/inquiry-side-panel.tsx`, `src/app/(app)/proposals/[id]/page.tsx`, and their tests
- Create: `src/components/proposals/proposal-read-view.tsx`, `src/components/proposals/proposal-read-view.test.tsx`

**Interfaces:**
- Consumes: `useIsCreator()` (Task 5); `ProposalSendHistory`, `ProposalShareActions`, `ProposalStatusBadge`; `useProposal`, `useProposalSendState`.
- Produces:
  - `readOnly?: boolean` props (default `false`) on `PipelineBoardDesktop`, `PipelineBoardMobile`, `OpportunitySidePanel` and `InquirySidePanel`;
  - `ProposalReadView({ proposalId })`.

- [ ] **Step 1: Write the failing tests**
  - **`PipelineBoardDesktop`** with `readOnly`: no drag sensors (assert `DndContext` receives an empty `sensors` array; or, more simply, assert that a drag attempt with the test's existing drag helper doesn't call `onMoveToStage`). Mirror the existing desktop board test style.
  - **`PipelineBoardMobile`** with `readOnly`: stage-move controls absent (read the component to name them; assert `queryByRole` null).
  - **`OpportunitySidePanel`** with `readOnly`: the stage select is disabled (`getByRole("combobox", { name: "Stage" })` `toBeDisabled()`), and "Nova Proposta" is absent.
  - **`InquirySidePanel`** with `readOnly`: no "Converter em Opportunity", "Descartar" or "Falso Positivo" buttons, and `registerActions` is not called with actions (or is called with no-ops; read how it's used and assert the shortcuts can't trigger mutations).
  - **`ProposalReadView`**, with the hooks mocked:
    - it renders the title, the status badge and an `iframe` with title `Apresentação da proposta` and `src="/proposals/p1/preview"`;
    - it renders the history;
    - with a `publicPath` in the send-state, it renders "Copiar link", an "Abrir" link and `ProposalShareActions`;
    - it never renders "Enviar proposta" or "Reenviar".
  - **Proposal page:** under `role="CREATOR"`, it renders `ProposalReadView` (mock it) instead of the editor (no "Arquivar" button, no title input).

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/components/pipeline src/components/inbox src/components/proposals "src/app/(app)"`

- [ ] **Step 3: Implement**
- **Pipeline page:** `const isCreator = useIsCreator();` and pass `readOnly={isCreator}` to both boards and the side panel.
- **Desktop board:** `const sensors = useSensors(...readOnly ? [] : [useSensor(PointerSensor, ...)])`. Respect hooks rules: always call `useSensor`, and pass `readOnly ? [] : [pointer]` into `useSensors`. Alternatively, keep the sensors and ignore drops when `readOnly` in `handleDragEnd`. Also render the cards without drag handles if the column uses `useDraggable`: pass `disabled: readOnly`.
- **Mobile board:** hide the stage-move controls when `readOnly`.
- **Side panel:** add `disabled={readOnly}` on the stage `Select`, and don't render the "Nova Proposta" trigger or dialog when `readOnly`.
- **Inbox:** the inbox page passes `readOnly={isCreator}` to `InquirySidePanel`. When `readOnly`, the panel skips the actions block (and the edit form) and registers no actions. "Nova Mensagem" stays.
- **`ProposalReadView`:**

```tsx
"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useProposal } from "@/hooks/use-proposal";
import { useProposalSendState } from "@/hooks/use-proposal-sending";
import { ProposalStatusBadge } from "@/components/proposals/proposal-status-badge";
import { ProposalSendHistory } from "@/components/proposals/proposal-send-history";
import { ProposalShareActions } from "@/components/proposals/proposal-share-actions";

/** What a CREATOR sees instead of the editor: presentation, status, history, sharing. */
export function ProposalReadView({ proposalId }: { proposalId: string }) {
  const { data: proposal } = useProposal(proposalId);
  const { data: state } = useProposalSendState(proposalId);
  if (!proposal) return null;

  async function copyLink(publicPath: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">{proposal.title}</h1>
        <ProposalStatusBadge status={proposal.status} />
      </div>
      {state?.publicPath ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => copyLink(state.publicPath!)}>
            Copiar link
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={state.publicPath} target="_blank" rel="noopener noreferrer">
              Abrir
            </a>
          </Button>
          <ProposalShareActions proposalId={proposalId} publicPath={state.publicPath} />
        </div>
      ) : null}
      <iframe
        title="Apresentação da proposta"
        src={`/proposals/${proposalId}/preview`}
        className="h-[70vh] w-full rounded-lg border border-border bg-card"
      />
      <ProposalSendHistory proposalId={proposalId} />
    </div>
  );
}
```

Check the real props of `ProposalStatusBadge` and `ProposalSendHistory`, and adapt the call sites. Drop the unused `Link` import if it isn't needed.

- **Proposal page:** at the top of `ProposalPage`, `const isCreator = useIsCreator();`. Keep all hooks unconditional, then `if (isCreator) return <ProposalReadView proposalId={proposalId} />;` before the editor render. Wrap existing page tests in an OWNER `SessionRoleProvider`.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/components "src/app/(app)"
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add -A src
git commit -m "feat: read-only CREATOR views for pipeline, inbox and proposals"
```

---

## Visual verification (controller, after Task 6)

In the local dev DB, add a CREATOR membership for a test user linked to the creator "Thais R.". The controller does this with SQL on the **local dev DB only**. Browser login as that user isn't possible without its credentials, so verify with the OWNER login instead:
- OWNER sees everything as before (regression check);
- the table test and the component tests cover CREATOR.

Report that the CREATOR UI was verified by tests, not visually. Spec C's invite flow makes a real CREATOR login possible later.

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3.1 session | 1 |
| §3.2 helpers | 1 |
| §3.3 repositories and owner-from-opportunity | 2 |
| §3.4 route rules, order, exceptions, CRM, creators GET, preview | 3 |
| §3.5 notifications | 4 |
| §4.1 layout payload, role context, sidebar, switcher | 5 |
| §4.2 Pipeline, Inbox and Proposal read view | 6 |
| §4.2 `/creators` redirect and form error | 5 |
| §5 tests | 1–6 |

**Placeholder scan:** three spots tell the implementer to read the real component or fixture and adapt:
- the resolve-session tests (the expectations are fixed);
- the mobile board control names;
- the prop shapes of existing components.

Each keeps a concrete assertion as the contract.

**Type consistency:**

| Name | Defined in | Used in |
|---|---|---|
| `creatorScope`, `denyCreatorWrite`, `canManageOrganization` | Task 1 | Tasks 3 and 5 |
| `isInCreatorScope`, `creatorIdForProposal`, `findById(..., scope)` | Task 2 | Tasks 3 and 4 |
| `seedTwoCreators` | Task 2 | Tasks 3 and 4 |
| `fanOutWithTx(..., audience)` | Task 4 | Task 4 |
| `useIsCreator` | Task 5 | Tasks 5 and 6 |
| `readOnly` props | Task 6 | Task 6 |
