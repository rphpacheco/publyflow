# Creator Approval Before Sending — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a proposal's creator has PublyFlow access, sending requires the creator's approval of the current version (or an explicit OWNER/MANAGER "send without approval").

**Architecture:** New `proposal_approvals` table (one row per request, decision written once) plus `approval_id` / `sent_without_approval` on `proposal_publications`. A pure `deriveApprovalState` computes the state from the latest request and latest version; `ProposalApprovalService` handles request/approve/request-changes under the proposal row lock; `ProposalSendingService.publish` enforces the gate. Four new domain events feed in-app notifications with creator-only or staff-only audiences. UI: approval block in the agency send panel and in the creator's `ProposalReadView`.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 + TanStack Query, Drizzle ORM + Postgres, zod 4, Vitest (+ Testing Library, jsdom).

Spec: `docs/superpowers/specs/2026-09-29-creator-approval-design.md`.

## Global Constraints

- The app connects as a role that bypasses RLS: **every query on a tenant table must carry an explicit `organization_id` predicate.** New table gets RLS + `org_isolation_proposal_approvals` policy anyway.
- Approval required ⇔ the opportunity's creator's `users` row has an `organization_members` row with `role = 'CREATOR'` in the proposal's organization.
- States: `not_required`, `none`, `pending`, `approved`, `changes_requested`, `stale` (spec §4.2). "Latest" request = highest `request_number`, never timestamps.
- Request, decision and publish lock the proposal row with `ProposalsRepository.lockByIdWithTx` first and read the latest version after the lock.
- Only the owning CREATOR decides; OWNER/MANAGER calling approve/request-changes → 403 `{ error: "Somente o creator pode aprovar." }`; another creator's proposal → 404.
- Error messages (exact, returned as `{ error }` with 409): `"Este creator não tem acesso ao PublyFlow; envie direto."`, `"Aguardando aprovação do creator."` (plus `code: "APPROVAL_REQUIRED"`), `"Não há pedido de aprovação pendente."`, `"A proposta mudou depois do pedido de aprovação."`. Postgres 40P01 → 409 `{ error: DEADLOCK_MESSAGE }` from `src/lib/db-errors.ts`.
- Changes-request message: trimmed, 1–2000 chars; empty → 400 `{ errors: { message: ["Descreva os ajustes."] } }`; >2000 → `"Use no máximo 2000 caracteres."`. Approve message optional, ≤2000.
- Notification copy (title / body): `Aprovação pedida` / `Revise e aprove "{title}".` (creator only); `Creator aprovou` / `{creatorDisplayName} aprovou "{title}".` (staff only); `Creator pediu ajustes` / `{creatorDisplayName} pediu ajustes em "{title}".` (staff only); `Enviada sem sua aprovação` / `"{title}" foi enviada ao cliente sem sua aprovação.` (creator only). `linkPath` = `/proposals/{id}`.
- UI copy (exact): see Tasks 6 and 7 tables. Toasts: `"Pedido de aprovação enviado."`, `"Proposta aprovada."`, `"Pedido de ajustes enviado."`.
- Every `[id]` route keeps the `isUuid` guard (malformed → the route's 404).
- **Hard DB rule for implementers:** never start/stop/restart Docker containers, never run `drizzle-kit migrate`/`push`, never create/drop databases, never run psql. `drizzle-kit generate` (writes files only) is allowed. If the test DB fails in any way, STOP and report BLOCKED. The controller applies migrations.
- Commands: pnpm is `/opt/homebrew/bin/pnpm`; tests `/opt/homebrew/bin/pnpm vitest run <paths> --testTimeout=60000 --hookTimeout=60000`; typecheck `/opt/homebrew/bin/pnpm tsc --noEmit`. Plain commands only (no chained commands with computed values). Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema/proposals.ts` (modify) | `proposalApprovalDecisionEnum`, `proposalApprovals`, publication columns |
| `src/db/migrations/0021_add_proposal_approvals.sql` (+ meta) | DDL + RLS |
| `src/test/helpers/db.ts` (modify) | add `proposal_approvals` to truncation list |
| `src/repositories/proposal-approvals.repository.ts` (new) | insert / latest / decide / creator access lookup |
| `src/lib/proposals/approval-state.ts` (new) | pure `deriveApprovalState` |
| `src/domain/proposals/errors.ts` (modify) | approval errors |
| `src/lib/events/proposal-events.ts` (modify) | 4 event types + builder |
| `src/services/proposal-approval.service.ts` (new) | request / approve / requestChanges |
| `src/services/proposal-sending.service.ts` (modify) | publish gate, send-state `approval`, history fields |
| `src/repositories/proposal-publications.repository.ts` (modify) | new insert fields, approver name in history |
| `src/repositories/notifications.repository.ts` (modify) | audience `only` |
| `src/services/event-handlers/proposal-notifications.ts` (modify) | approval handlers |
| `src/app/api/proposals/[id]/approval/**` (new) | 3 routes |
| `src/app/api/proposals/[id]/publications/route.ts` (modify) | `withoutApproval`, 409 |
| `src/app/api/write-guard.test.ts` (modify) | allowlist creator routes |
| `src/hooks/use-proposal-sending.ts` (modify) | DTOs + mutations |
| `src/components/proposals/proposal-send-panel.tsx` (modify) | agency approval block |
| `src/components/proposals/proposal-send-history.tsx` (modify) | approval labels |
| `src/components/proposals/proposal-approval-block.tsx` (new) | creator approval block |
| `src/components/proposals/proposal-read-view.tsx` (modify) | render the block |

---

### Task 1: Schema, migration 0021, approvals repository

**Files:**
- Modify: `src/db/schema/proposals.ts`
- Create: `src/db/migrations/0021_add_proposal_approvals.sql` (generated, then RLS appended), `src/db/migrations/meta/0021_snapshot.json`, `_journal.json` entry (generated)
- Modify: `src/test/helpers/db.ts`
- Create: `src/repositories/proposal-approvals.repository.ts`, `src/repositories/proposal-approvals.repository.test.ts`

**Interfaces — Produces:**
```ts
export type ProposalApproval = typeof proposalApprovals.$inferSelect; // id, organizationId, proposalId, requestNumber, versionId, versionNumber, requestedBy, requestedAt, decision: "APPROVED"|"CHANGES_REQUESTED"|null, decidedBy, decidedAt, message
export interface CreatorAccessForProposal { creatorId: string; creatorUserId: string; creatorDisplayName: string; hasAccess: boolean }
ProposalApprovalsRepository.insertWithTx(tx, organizationId, { proposalId, versionId, versionNumber, requestedBy }): Promise<ProposalApproval>
ProposalApprovalsRepository.findLatestWithTx(tx, organizationId, proposalId): Promise<ProposalApproval | null>
ProposalApprovalsRepository.findLatestWithRequesterWithTx(tx, organizationId, proposalId): Promise<{ approval: ProposalApproval; requestedByName: string } | null>
ProposalApprovalsRepository.decideWithTx(tx, organizationId, approvalId, { decision, decidedBy, decidedAt, message }): Promise<ProposalApproval | null> // null = already decided
ProposalApprovalsRepository.creatorAccessForProposalWithTx(tx, organizationId, proposalId): Promise<CreatorAccessForProposal | null>
```
Publications table gains `approvalId: string | null`, `sentWithoutApproval: boolean`.

- [ ] **Step 1: Schema.** In `src/db/schema/proposals.ts` add `check` to the `drizzle-orm/pg-core` import and `import { sql } from "drizzle-orm";`. Add after `proposalResponseActionEnum`:

```ts
export const proposalApprovalDecisionEnum = pgEnum("proposal_approval_decision", ["APPROVED", "CHANGES_REQUESTED"]);

/** One row per approval request (spec D §3.2). The decision is written once. */
export const proposalApprovals = pgTable(
  "proposal_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    /** 1, 2, 3… per proposal; defines "latest" (never rely on timestamps). */
    requestNumber: integer("request_number").notNull(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => proposalVersions.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decision: proposalApprovalDecisionEnum("decision"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    message: text("message"),
  },
  (table) => [
    unique("proposal_approvals_proposal_number_unique").on(table.proposalId, table.requestNumber),
    index("proposal_approvals_proposal_idx").on(table.proposalId),
    check(
      "proposal_approvals_decision_consistent",
      sql`((${table.decision} is null) = (${table.decidedBy} is null)) and ((${table.decision} is null) = (${table.decidedAt} is null))`,
    ),
    check(
      "proposal_approvals_changes_message",
      sql`${table.decision} is distinct from 'CHANGES_REQUESTED' or (${table.message} is not null and length(btrim(${table.message})) > 0)`,
    ),
  ],
);
```
`proposalApprovals` must be declared before `proposalPublications` (publications reference it). In `proposalPublications` add columns after `publishedAt`:
```ts
    /** The approval that authorized this send (spec D §3.3). */
    approvalId: uuid("approval_id").references(() => proposalApprovals.id, { onDelete: "restrict" }),
    sentWithoutApproval: boolean("sent_without_approval").notNull().default(false),
```
(add `boolean` to the pg-core import) and to its table callback:
```ts
    check(
      "proposal_publications_approval_consistent",
      sql`not (${table.sentWithoutApproval} and ${table.approvalId} is not null)`,
    ),
```
Make sure `src/db/schema/index.ts` re-exports everything from `proposals.ts` (it already exports the module; verify).

- [ ] **Step 2: Generate the migration.** Run `/opt/homebrew/bin/pnpm drizzle-kit generate --name add_proposal_approvals` (writes files only). Confirm it produced `0021_add_proposal_approvals.sql` with the enum, table, FKs, unique, index, the three checks and the two `ALTER TABLE proposal_publications ADD COLUMN`s — nothing else. Append to the SQL:
```sql
--> statement-breakpoint
alter table proposal_approvals enable row level security;
--> statement-breakpoint
create policy org_isolation_proposal_approvals on proposal_approvals
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
```

- [ ] **Step 3: STOP — hand the migration to the controller.** Report status `NEEDS_CONTEXT` with "migration 0021 ready". The controller applies it to `publyflow_test` and `publyflow` and resumes you. Do not run any migration yourself.

- [ ] **Step 4: Truncation list.** In `src/test/helpers/db.ts` `DOMAIN_TABLES`, insert `"proposal_approvals"` right after `"proposal_publications"` (publications reference approvals; approvals reference versions).

- [ ] **Step 5: Failing repository tests** — `src/repositories/proposal-approvals.repository.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalApprovalsRepository } from "./proposal-approvals.repository";
import { ProposalVersionsRepository } from "./proposal-versions.repository";
import { runInTenantContext } from "./tenant-context";
import { organizationMembers } from "@/db/schema/organizations";
import { proposalApprovals } from "@/db/schema/proposals";

describe("ProposalApprovalsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    const [version] = await ProposalVersionsRepository.listByProposal(db, seeded.organization.id, seeded.proposal.id);
    return { db, ...seeded, version };
  }

  it("numbers requests 1, 2 per proposal and finds the latest", async () => {
    const { db, organization, owner, proposal, version } = await setup();
    const input = { proposalId: proposal.id, versionId: version.id, versionNumber: version.versionNumber, requestedBy: owner.id };
    await runInTenantContext(db, organization.id, (tx) => ProposalApprovalsRepository.insertWithTx(tx, organization.id, input));
    const second = await runInTenantContext(db, organization.id, (tx) => ProposalApprovalsRepository.insertWithTx(tx, organization.id, input));
    expect(second.requestNumber).toBe(2);
    const latest = await runInTenantContext(db, organization.id, (tx) => ProposalApprovalsRepository.findLatestWithTx(tx, organization.id, proposal.id));
    expect(latest?.id).toBe(second.id);
    const withName = await runInTenantContext(db, organization.id, (tx) =>
      ProposalApprovalsRepository.findLatestWithRequesterWithTx(tx, organization.id, proposal.id),
    );
    expect(withName).toMatchObject({ approval: { id: second.id }, requestedByName: "Owner" });
  });

  it("decides once; a second decision returns null", async () => {
    const { db, organization, owner, creator, proposal, version } = await setup();
    const approval = await runInTenantContext(db, organization.id, (tx) =>
      ProposalApprovalsRepository.insertWithTx(tx, organization.id, { proposalId: proposal.id, versionId: version.id, versionNumber: 1, requestedBy: owner.id }),
    );
    const decide = () =>
      runInTenantContext(db, organization.id, (tx) =>
        ProposalApprovalsRepository.decideWithTx(tx, organization.id, approval.id, {
          decision: "APPROVED",
          decidedBy: creator.userId,
          decidedAt: new Date(),
          message: null,
        }),
      );
    expect((await decide())?.decision).toBe("APPROVED");
    expect(await decide()).toBeNull();
  });

  it("rejects CHANGES_REQUESTED without a message and inconsistent decision columns", async () => {
    const { db, organization, owner, creator, proposal, version } = await setup();
    const base = { organizationId: organization.id, proposalId: proposal.id, versionId: version.id, versionNumber: 1, requestedBy: owner.id };
    await expect(
      db.insert(proposalApprovals).values({ ...base, requestNumber: 1, decision: "CHANGES_REQUESTED", decidedBy: creator.userId, decidedAt: new Date(), message: "  " }),
    ).rejects.toThrow();
    await expect(db.insert(proposalApprovals).values({ ...base, requestNumber: 2, decision: "APPROVED" })).rejects.toThrow();
  });

  it("creatorAccessForProposal: hasAccess only with a CREATOR membership in this org", async () => {
    const { db, organization, creator, proposal } = await setup();
    const read = () =>
      runInTenantContext(db, organization.id, (tx) => ProposalApprovalsRepository.creatorAccessForProposalWithTx(tx, organization.id, proposal.id));
    expect(await read()).toEqual({ creatorId: creator.id, creatorUserId: creator.userId, creatorDisplayName: "Thais", hasAccess: false });
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creator.userId, role: "CREATOR" });
    expect((await read())?.hasAccess).toBe(true);
  });

  it("scopes by organization: another org sees nothing", async () => {
    const { db, organization, owner, proposal, version } = await setup();
    const other = await seedProposal(db);
    await runInTenantContext(db, organization.id, (tx) =>
      ProposalApprovalsRepository.insertWithTx(tx, organization.id, { proposalId: proposal.id, versionId: version.id, versionNumber: 1, requestedBy: owner.id }),
    );
    const leaked = await runInTenantContext(db, other.organization.id, (tx) =>
      ProposalApprovalsRepository.findLatestWithTx(tx, other.organization.id, proposal.id),
    );
    expect(leaked).toBeNull();
    const access = await runInTenantContext(db, other.organization.id, (tx) =>
      ProposalApprovalsRepository.creatorAccessForProposalWithTx(tx, other.organization.id, proposal.id),
    );
    expect(access).toBeNull();
  });
});
```
Run: `/opt/homebrew/bin/pnpm vitest run src/repositories/proposal-approvals.repository.test.ts --testTimeout=60000 --hookTimeout=60000` — expected FAIL (module not found).

- [ ] **Step 6: Implement** `src/repositories/proposal-approvals.repository.ts`:
```ts
import { and, desc, eq, isNull, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalApprovals, proposals } from "@/db/schema/proposals";
import { opportunities } from "@/db/schema/commercial-flow";
import { creators } from "@/db/schema/creators";
import { organizationMembers, users } from "@/db/schema/organizations";

export type ProposalApproval = typeof proposalApprovals.$inferSelect;
export type ApprovalDecision = NonNullable<ProposalApproval["decision"]>;

export interface CreatorAccessForProposal {
  creatorId: string;
  creatorUserId: string;
  creatorDisplayName: string;
  hasAccess: boolean;
}

export const ProposalApprovalsRepository = {
  /** Caller must hold the proposal row lock (numbers are max + 1). */
  async insertWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: { proposalId: string; versionId: string; versionNumber: number; requestedBy: string },
  ): Promise<ProposalApproval> {
    const [{ current }] = await tx
      .select({ current: max(proposalApprovals.requestNumber) })
      .from(proposalApprovals)
      .where(and(eq(proposalApprovals.proposalId, input.proposalId), eq(proposalApprovals.organizationId, organizationId)));
    const [approval] = await tx
      .insert(proposalApprovals)
      .values({ organizationId, requestNumber: (current ?? 0) + 1, ...input })
      .returning();
    return approval;
  },

  async findLatestWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string): Promise<ProposalApproval | null> {
    const [approval] = await tx
      .select()
      .from(proposalApprovals)
      .where(and(eq(proposalApprovals.proposalId, proposalId), eq(proposalApprovals.organizationId, organizationId)))
      .orderBy(desc(proposalApprovals.requestNumber))
      .limit(1);
    return approval ?? null;
  },

  async findLatestWithRequesterWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<{ approval: ProposalApproval; requestedByName: string } | null> {
    const [row] = await tx
      .select({ approval: proposalApprovals, requestedByName: users.fullName })
      .from(proposalApprovals)
      .innerJoin(users, eq(users.id, proposalApprovals.requestedBy))
      .where(and(eq(proposalApprovals.proposalId, proposalId), eq(proposalApprovals.organizationId, organizationId)))
      .orderBy(desc(proposalApprovals.requestNumber))
      .limit(1);
    return row ?? null;
  },

  /** Written once: returns null when the request was already decided. */
  async decideWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    approvalId: string,
    input: { decision: ApprovalDecision; decidedBy: string; decidedAt: Date; message: string | null },
  ): Promise<ProposalApproval | null> {
    const [approval] = await tx
      .update(proposalApprovals)
      .set(input)
      .where(
        and(eq(proposalApprovals.id, approvalId), eq(proposalApprovals.organizationId, organizationId), isNull(proposalApprovals.decision)),
      )
      .returning();
    return approval ?? null;
  },

  /** The proposal's creator and whether it holds a CREATOR membership in this organization (spec D §4.1). */
  async creatorAccessForProposalWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<CreatorAccessForProposal | null> {
    const [row] = await tx
      .select({
        creatorId: creators.id,
        creatorUserId: creators.userId,
        creatorDisplayName: creators.displayName,
        membershipUserId: organizationMembers.userId,
      })
      .from(proposals)
      .innerJoin(opportunities, and(eq(opportunities.id, proposals.opportunityId), eq(opportunities.organizationId, organizationId)))
      .innerJoin(creators, and(eq(creators.id, opportunities.creatorId), eq(creators.organizationId, organizationId)))
      .leftJoin(
        organizationMembers,
        and(
          eq(organizationMembers.userId, creators.userId),
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.role, "CREATOR"),
        ),
      )
      .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)));
    if (!row) return null;
    return {
      creatorId: row.creatorId,
      creatorUserId: row.creatorUserId,
      creatorDisplayName: row.creatorDisplayName,
      hasAccess: row.membershipUserId !== null,
    };
  },
};
```
- [ ] **Step 7:** Run the test file — PASS. Run `/opt/homebrew/bin/pnpm tsc --noEmit` — clean.
- [ ] **Step 8: Commit** `feat(proposals): proposal_approvals table and repository (migration 0021)`.

---

### Task 2: Approval state, errors, events, ProposalApprovalService

**Files:**
- Create: `src/lib/proposals/approval-state.ts`, `src/lib/proposals/approval-state.test.ts`
- Modify: `src/domain/proposals/errors.ts`, `src/lib/events/proposal-events.ts`
- Create: `src/services/proposal-approval.service.ts`, `src/services/proposal-approval.service.test.ts`

**Interfaces — Consumes:** Task 1 repository. **Produces:**
```ts
export type ApprovalState = "not_required" | "none" | "pending" | "approved" | "changes_requested" | "stale";
export function deriveApprovalState(input: { required: boolean; latestVersionNumber: number; latest: { versionNumber: number; decision: "APPROVED" | "CHANGES_REQUESTED" | null } | null }): ApprovalState;
// errors (src/domain/proposals/errors.ts)
ApprovalNotRequiredError, ApprovalRequiredError, NoPendingApprovalError, ApprovalStaleError, NotProposalCreatorError
// events
PROPOSAL_EVENT.APPROVAL_REQUESTED = "proposal.approval_requested"; CREATOR_APPROVED = "proposal.creator_approved"; CREATOR_CHANGES_REQUESTED = "proposal.creator_changes_requested"; SENT_WITHOUT_APPROVAL = "proposal.sent_without_approval"
proposalApprovalEvent(input: ApprovalEventInput): AppendEventInput
// service
ProposalApprovalService.request(db, organizationId, proposalId, userId): Promise<{ approval: ProposalApproval; created: boolean }>
ProposalApprovalService.approve(db, organizationId, proposalId, userId, message: string | null): Promise<ProposalApproval>
ProposalApprovalService.requestChanges(db, organizationId, proposalId, userId, message: string): Promise<ProposalApproval>
```

- [ ] **Step 1: Failing pure test** `src/lib/proposals/approval-state.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { deriveApprovalState } from "./approval-state";

describe("deriveApprovalState (spec D §4.2)", () => {
  it.each([
    [false, 3, null, "not_required"],
    [false, 3, { versionNumber: 3, decision: "APPROVED" }, "not_required"],
    [true, 3, null, "none"],
    [true, 3, { versionNumber: 2, decision: null }, "stale"],
    [true, 3, { versionNumber: 2, decision: "APPROVED" }, "stale"],
    [true, 3, { versionNumber: 3, decision: null }, "pending"],
    [true, 3, { versionNumber: 3, decision: "APPROVED" }, "approved"],
    [true, 3, { versionNumber: 3, decision: "CHANGES_REQUESTED" }, "changes_requested"],
  ] as const)("required=%s latest v%s request %j → %s", (required, latestVersionNumber, latest, expected) => {
    expect(deriveApprovalState({ required, latestVersionNumber, latest })).toBe(expected);
  });
});
```
- [ ] **Step 2: Implement** `src/lib/proposals/approval-state.ts`:
```ts
export type ApprovalState = "not_required" | "none" | "pending" | "approved" | "changes_requested" | "stale";

/** Spec D §4.2 — derived, never stored. */
export function deriveApprovalState(input: {
  required: boolean;
  latestVersionNumber: number;
  latest: { versionNumber: number; decision: "APPROVED" | "CHANGES_REQUESTED" | null } | null;
}): ApprovalState {
  if (!input.required) return "not_required";
  if (!input.latest) return "none";
  if (input.latest.versionNumber !== input.latestVersionNumber) return "stale";
  if (input.latest.decision === "APPROVED") return "approved";
  if (input.latest.decision === "CHANGES_REQUESTED") return "changes_requested";
  return "pending";
}
```
Run it — PASS.

- [ ] **Step 3: Errors.** Append to `src/domain/proposals/errors.ts` (these messages are shown to users verbatim):
```ts
// Spec D: approval errors. Messages are user-facing (routes return them as-is).
export class ApprovalNotRequiredError extends Error {
  constructor() {
    super("Este creator não tem acesso ao PublyFlow; envie direto.");
    this.name = "ApprovalNotRequiredError";
  }
}

export class ApprovalRequiredError extends Error {
  constructor() {
    super("Aguardando aprovação do creator.");
    this.name = "ApprovalRequiredError";
  }
}

export class NoPendingApprovalError extends Error {
  constructor() {
    super("Não há pedido de aprovação pendente.");
    this.name = "NoPendingApprovalError";
  }
}

export class ApprovalStaleError extends Error {
  constructor() {
    super("A proposta mudou depois do pedido de aprovação.");
    this.name = "ApprovalStaleError";
  }
}

// The deciding user is not the proposal's creator (defense in depth behind the route checks).
export class NotProposalCreatorError extends Error {
  constructor() {
    super("Somente o creator pode aprovar.");
    this.name = "NotProposalCreatorError";
  }
}
```

- [ ] **Step 4: Events.** In `src/lib/events/proposal-events.ts` extend `PROPOSAL_EVENT` with:
```ts
  APPROVAL_REQUESTED: "proposal.approval_requested",
  CREATOR_APPROVED: "proposal.creator_approved",
  CREATOR_CHANGES_REQUESTED: "proposal.creator_changes_requested",
  SENT_WITHOUT_APPROVAL: "proposal.sent_without_approval",
```
and add:
```ts
export interface ApprovalEventInput {
  eventType:
    | typeof PROPOSAL_EVENT.APPROVAL_REQUESTED
    | typeof PROPOSAL_EVENT.CREATOR_APPROVED
    | typeof PROPOSAL_EVENT.CREATOR_CHANGES_REQUESTED
    | typeof PROPOSAL_EVENT.SENT_WITHOUT_APPROVAL;
  proposalId: string;
  proposalTitle: string;
  opportunityId: string;
  versionNumber: number;
  approvalId: string | null;
  publicationId: string | null;
  creatorDisplayName: string;
  userId: string;
}

export function proposalApprovalEvent(input: ApprovalEventInput): AppendEventInput {
  return {
    eventType: input.eventType,
    entityType: "proposal",
    entityId: input.proposalId,
    payload: {
      proposal_id: input.proposalId,
      proposal_title: input.proposalTitle,
      opportunity_id: input.opportunityId,
      version_number: input.versionNumber,
      approval_id: input.approvalId,
      publication_id: input.publicationId,
      creator_display_name: input.creatorDisplayName,
    },
    actor: { kind: "user", user_id: input.userId },
  };
}
```

- [ ] **Step 5: Failing service tests** `src/services/proposal-approval.service.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalApprovalService } from "./proposal-approval.service";
import { ProposalService } from "./proposal.service";
import { organizationMembers } from "@/db/schema/organizations";
import { domainEvents } from "@/db/schema/domain-events";
import {
  ApprovalNotRequiredError,
  ApprovalStaleError,
  NoPendingApprovalError,
  NotProposalCreatorError,
  ProposalArchivedError,
} from "@/domain/proposals/errors";

describe("ProposalApprovalService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup({ access = true } = {}) {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    if (access) {
      await db.insert(organizationMembers).values({ organizationId: seeded.organization.id, userId: seeded.creator.userId, role: "CREATOR" });
    }
    return { db, ...seeded };
  }

  async function events(db: Awaited<ReturnType<typeof setup>>["db"], organizationId: string, eventType: string) {
    return db.select().from(domainEvents).where(and(eq(domainEvents.organizationId, organizationId), eq(domainEvents.eventType, eventType)));
  }

  it("request: creates request 1 for the latest version and emits approval_requested", async () => {
    const { db, organization, owner, proposal } = await setup();
    const result = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    expect(result.created).toBe(true);
    expect(result.approval).toMatchObject({ requestNumber: 1, versionNumber: 1, decision: null, requestedBy: owner.id });
    const emitted = await events(db, organization.id, "proposal.approval_requested");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ proposal_id: proposal.id, approval_id: result.approval.id, creator_display_name: "Thais" });
  });

  it("request: idempotent while pending or approved for the same version", async () => {
    const { db, organization, owner, creator, proposal } = await setup();
    const first = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    const again = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    expect(again).toMatchObject({ created: false, approval: { id: first.approval.id } });
    await ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, null);
    expect((await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id)).created).toBe(false);
  });

  it("request: new request after changes_requested and after an edit (stale)", async () => {
    const { db, organization, owner, creator, proposal } = await setup();
    await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await ProposalApprovalService.requestChanges(db, organization.id, proposal.id, creator.userId, "Trocar o preço");
    const afterChanges = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    expect(afterChanges).toMatchObject({ created: true, approval: { requestNumber: 2, versionNumber: 1 } });

    await ProposalService.update(db, organization.id, proposal.id, { title: "Campanha Verão 2", userId: owner.id });
    const afterEdit = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    expect(afterEdit).toMatchObject({ created: true, approval: { requestNumber: 3, versionNumber: 2 } });
  });

  it("request: 'not required' when the creator has no access; archived proposal rejected", async () => {
    const noAccess = await setup({ access: false });
    await expect(ProposalApprovalService.request(noAccess.db, noAccess.organization.id, noAccess.proposal.id, noAccess.owner.id)).rejects.toBeInstanceOf(
      ApprovalNotRequiredError,
    );
    await cleanup();
    const { db, organization, owner, proposal } = await setup();
    await ProposalService.archive(db, organization.id, proposal.id, owner.id);
    await expect(ProposalApprovalService.request(db, organization.id, proposal.id, owner.id)).rejects.toBeInstanceOf(ProposalArchivedError);
  });

  it("approve: records the decision and emits creator_approved; second decision fails", async () => {
    const { db, organization, owner, creator, proposal } = await setup();
    await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    const approved = await ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, "Perfeito");
    expect(approved).toMatchObject({ decision: "APPROVED", decidedBy: creator.userId, message: "Perfeito" });
    expect(await events(db, organization.id, "proposal.creator_approved")).toHaveLength(1);
    await expect(ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, null)).rejects.toBeInstanceOf(NoPendingApprovalError);
  });

  it("approve: no request → NoPending; stale → ApprovalStale; non-creator user → NotProposalCreator", async () => {
    const { db, organization, owner, creator, proposal } = await setup();
    await expect(ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, null)).rejects.toBeInstanceOf(NoPendingApprovalError);
    await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await expect(ProposalApprovalService.approve(db, organization.id, proposal.id, owner.id, null)).rejects.toBeInstanceOf(NotProposalCreatorError);
    await ProposalService.update(db, organization.id, proposal.id, { title: "Mudou", userId: owner.id });
    await expect(ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, null)).rejects.toBeInstanceOf(ApprovalStaleError);
  });

  it("requestChanges: stores the trimmed message and emits creator_changes_requested", async () => {
    const { db, organization, owner, creator, proposal } = await setup();
    await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    const decided = await ProposalApprovalService.requestChanges(db, organization.id, proposal.id, creator.userId, "  Trocar a capa  ");
    expect(decided).toMatchObject({ decision: "CHANGES_REQUESTED", message: "Trocar a capa" });
    expect(await events(db, organization.id, "proposal.creator_changes_requested")).toHaveLength(1);
  });
});
```
Before writing, check the exact names used here against the codebase and adapt the test if they differ (keep the assertions): `ProposalService.update(db, orgId, id, { title, userId })` must create a new version (it does — `proposal.service.ts:95`); `ProposalService.archive` — if the archive method has a different name/signature, use the existing one (grep `ARCHIVED` in `proposal.service.ts`); `domainEvents` schema import path (grep `pgTable("domain_events"`). Run the file — FAIL (module missing).

- [ ] **Step 6: Implement** `src/services/proposal-approval.service.ts`:
```ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository, type Proposal } from "@/repositories/proposals.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import {
  ProposalApprovalsRepository,
  type ApprovalDecision,
  type CreatorAccessForProposal,
  type ProposalApproval,
} from "@/repositories/proposal-approvals.repository";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { assertMember } from "./proposal.service";
import { deriveApprovalState } from "@/lib/proposals/approval-state";
import { PROPOSAL_EVENT, proposalApprovalEvent } from "@/lib/events/proposal-events";
import {
  ApprovalNotRequiredError,
  ApprovalStaleError,
  NoPendingApprovalError,
  NotProposalCreatorError,
  ProposalArchivedError,
  ProposalNotFoundError,
} from "@/domain/proposals/errors";

type Tx = NodePgDatabase<typeof schema>;

/** Lock the proposal, then read everything the approval rules need (spec D §8). */
async function loadLocked(tx: Tx, organizationId: string, proposalId: string) {
  const proposal = await ProposalsRepository.lockByIdWithTx(tx, organizationId, proposalId);
  if (!proposal) throw new ProposalNotFoundError(proposalId);
  const latestVersion = await ProposalVersionsRepository.findLatestWithTx(tx, organizationId, proposalId);
  if (!latestVersion) throw new ProposalNotFoundError(proposalId);
  const access = await ProposalApprovalsRepository.creatorAccessForProposalWithTx(tx, organizationId, proposalId);
  if (!access) throw new ProposalNotFoundError(proposalId);
  const latest = await ProposalApprovalsRepository.findLatestWithTx(tx, organizationId, proposalId);
  return { proposal, latestVersion, access, latest };
}

function eventFor(
  eventType: Parameters<typeof proposalApprovalEvent>[0]["eventType"],
  proposal: Proposal,
  access: CreatorAccessForProposal,
  approval: ProposalApproval,
  userId: string,
) {
  return proposalApprovalEvent({
    eventType,
    proposalId: proposal.id,
    proposalTitle: proposal.title,
    opportunityId: proposal.opportunityId,
    versionNumber: approval.versionNumber,
    approvalId: approval.id,
    publicationId: null,
    creatorDisplayName: access.creatorDisplayName,
    userId,
  });
}

async function decide(
  db: Tx,
  organizationId: string,
  proposalId: string,
  userId: string,
  decision: ApprovalDecision,
  message: string | null,
): Promise<ProposalApproval> {
  return runInTenantContext(db, organizationId, async (tx) => {
    const { proposal, latestVersion, access, latest } = await loadLocked(tx, organizationId, proposalId);
    if (access.creatorUserId !== userId) throw new NotProposalCreatorError();
    if (!latest || latest.decision !== null) throw new NoPendingApprovalError();
    if (latest.versionNumber !== latestVersion.versionNumber) throw new ApprovalStaleError();

    const decided = await ProposalApprovalsRepository.decideWithTx(tx, organizationId, latest.id, {
      decision,
      decidedBy: userId,
      decidedAt: new Date(),
      message,
    });
    if (!decided) throw new NoPendingApprovalError();

    await DomainEventsRepository.appendWithTx(
      tx,
      organizationId,
      eventFor(
        decision === "APPROVED" ? PROPOSAL_EVENT.CREATOR_APPROVED : PROPOSAL_EVENT.CREATOR_CHANGES_REQUESTED,
        proposal,
        access,
        decided,
        userId,
      ),
    );
    return decided;
  });
}

export const ProposalApprovalService = {
  /** Spec D §4.3 — OWNER/MANAGER. */
  async request(db: Tx, organizationId: string, proposalId: string, userId: string): Promise<{ approval: ProposalApproval; created: boolean }> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, userId);
      const { proposal, latestVersion, access, latest } = await loadLocked(tx, organizationId, proposalId);
      if (proposal.status === "ARCHIVED") throw new ProposalArchivedError(proposalId);
      if (!access.hasAccess) throw new ApprovalNotRequiredError();

      const state = deriveApprovalState({ required: true, latestVersionNumber: latestVersion.versionNumber, latest });
      if (latest && (state === "pending" || state === "approved")) return { approval: latest, created: false };

      const approval = await ProposalApprovalsRepository.insertWithTx(tx, organizationId, {
        proposalId,
        versionId: latestVersion.id,
        versionNumber: latestVersion.versionNumber,
        requestedBy: userId,
      });
      await DomainEventsRepository.appendWithTx(tx, organizationId, eventFor(PROPOSAL_EVENT.APPROVAL_REQUESTED, proposal, access, approval, userId));
      return { approval, created: true };
    });
  },

  /** Spec D §4.4 — the owning CREATOR only. */
  async approve(db: Tx, organizationId: string, proposalId: string, userId: string, message: string | null): Promise<ProposalApproval> {
    const trimmed = message?.trim() || null;
    return decide(db, organizationId, proposalId, userId, "APPROVED", trimmed);
  },

  async requestChanges(db: Tx, organizationId: string, proposalId: string, userId: string, message: string): Promise<ProposalApproval> {
    return decide(db, organizationId, proposalId, userId, "CHANGES_REQUESTED", message.trim());
  },
};
```
If `Proposal` is not exported by `proposals.repository.ts`, use `NonNullable<Awaited<ReturnType<typeof ProposalsRepository.lockByIdWithTx>>>`. `assertMember` is exported by `proposal.service.ts` (the publish path uses it).

- [ ] **Step 7:** Run both test files — PASS; `tsc --noEmit` clean.
- [ ] **Step 8: Commit** `feat(proposals): approval state and ProposalApprovalService`.

---

### Task 3: Publish gate, send-state `approval`, history fields

**Files:**
- Modify: `src/repositories/proposal-publications.repository.ts`, `src/services/proposal-sending.service.ts`
- Test: `src/services/proposal-sending.service.test.ts` (add a `describe("approval gate (spec D §4.5)")`)

**Interfaces — Consumes:** Tasks 1–2. **Produces:**
```ts
ProposalSendingService.publish(db, organizationId, proposalId, userId, options?: { withoutApproval?: boolean })
export interface SendStateApproval {
  state: ApprovalState;
  required: boolean;
  creatorName: string | null;
  current: { id: string; versionNumber: number; requestedAt: Date; requestedByName: string; decision: "APPROVED" | "CHANGES_REQUESTED" | null; decidedAt: Date | null; message: string | null } | null;
}
SendState.approval: SendStateApproval
PublicationHistoryItem.approvedByName: string | null; PublicationHistoryItem.sentWithoutApproval: boolean
```

- [ ] **Step 1: Failing tests** — append to `src/services/proposal-sending.service.test.ts` (add imports `ProposalApprovalService` from `./proposal-approval.service`, `organizationMembers` from `@/db/schema/organizations`, `domainEvents` from its schema module, `ApprovalRequiredError` from `@/domain/proposals/errors`, and `and` from `drizzle-orm`):
```ts
describe("approval gate (spec D §4.5)", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setupWithAccess() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    await db.insert(organizationMembers).values({ organizationId: seeded.organization.id, userId: seeded.creator.userId, role: "CREATOR" });
    return { db, ...seeded };
  }

  it("creator without access: publishes as before, no approval data", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const result = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    expect(result.publication).toMatchObject({ approvalId: null, sentWithoutApproval: false });
    const state = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(state?.approval).toEqual({ state: "not_required", required: false, creatorName: "Thais", current: null });
  });

  it("required and not approved → ApprovalRequiredError, nothing published", async () => {
    const { db, organization, owner, proposal } = await setupWithAccess();
    await expect(ProposalSendingService.publish(db, organization.id, proposal.id, owner.id)).rejects.toBeInstanceOf(ApprovalRequiredError);
    await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await expect(ProposalSendingService.publish(db, organization.id, proposal.id, owner.id)).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(await ProposalSendingService.listPublications(db, organization.id, proposal.id)).toEqual([]);
  });

  it("approved → publication stores approval_id; history shows the approver", async () => {
    const { db, organization, owner, creator, proposal } = await setupWithAccess();
    const { approval } = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, null);
    const result = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    expect(result.publication).toMatchObject({ approvalId: approval.id, sentWithoutApproval: false });
    const [item] = (await ProposalSendingService.listPublications(db, organization.id, proposal.id))!;
    expect(item).toMatchObject({ approvedByName: "Thais", sentWithoutApproval: false });
  });

  it("withoutApproval → flag stored, event emitted; ignored when approved", async () => {
    const { db, organization, owner, proposal } = await setupWithAccess();
    const result = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id, { withoutApproval: true });
    expect(result.publication).toMatchObject({ approvalId: null, sentWithoutApproval: true });
    const emitted = await db
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.organizationId, organization.id), eq(domainEvents.eventType, "proposal.sent_without_approval")));
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ publication_id: result.publication.id, creator_display_name: "Thais" });
    const [item] = (await ProposalSendingService.listPublications(db, organization.id, proposal.id))!;
    expect(item).toMatchObject({ approvedByName: null, sentWithoutApproval: true });
  });

  it("idempotent re-publish of an already-published version is not gated", async () => {
    const { db, organization, owner, proposal } = await setupWithAccess();
    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id, { withoutApproval: true });
    const again = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    expect(again.created).toBe(false);
  });

  it("send-state exposes the approval block", async () => {
    const { db, organization, owner, creator, proposal } = await setupWithAccess();
    expect((await ProposalSendingService.getSendState(db, organization.id, proposal.id))?.approval).toEqual({
      state: "none",
      required: true,
      creatorName: "Thais",
      current: null,
    });
    await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await ProposalApprovalService.requestChanges(db, organization.id, proposal.id, creator.userId, "Ajustar preço");
    const state = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(state?.approval).toMatchObject({
      state: "changes_requested",
      required: true,
      current: { versionNumber: 1, requestedByName: "Owner", decision: "CHANGES_REQUESTED", message: "Ajustar preço" },
    });
  });
});
```
Run — FAIL.

- [ ] **Step 2: Repository.** In `proposal-publications.repository.ts`:
  - `InsertPublicationInput` gains `approvalId: string | null; sentWithoutApproval: boolean;`.
  - `listWithResponsesWithTx` also returns the approver name. Add imports `alias` from `drizzle-orm/pg-core`, `proposalApprovals` from `@/db/schema/proposals`, `users` from `@/db/schema/organizations`, and replace the method with:
```ts
  async listWithResponsesWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<Array<{ publication: ProposalPublication; response: ProposalResponse | null; approvedByName: string | null }>> {
    const approver = alias(users, "approver");
    const rows = await tx
      .select({ publication: proposalPublications, response: proposalResponses, approvedByName: approver.fullName })
      .from(proposalPublications)
      .leftJoin(proposalResponses, eq(proposalResponses.publicationId, proposalPublications.id))
      .leftJoin(
        proposalApprovals,
        and(eq(proposalApprovals.id, proposalPublications.approvalId), eq(proposalApprovals.organizationId, organizationId)),
      )
      .leftJoin(approver, eq(approver.id, proposalApprovals.decidedBy))
      .where(and(eq(proposalPublications.proposalId, proposalId), eq(proposalPublications.organizationId, organizationId)))
      .orderBy(desc(proposalPublications.publicationNumber));
    return rows.map((row) => ({ publication: row.publication, response: row.response ?? null, approvedByName: row.approvedByName ?? null }));
  },
```
  Update any other caller of `listWithResponsesWithTx` / `insertWithTx` (grep) so types compile; existing callers of `insertWithTx` outside `publish` (e.g. tests/fixtures) pass `approvalId: null, sentWithoutApproval: false`.

- [ ] **Step 3: Service.** In `proposal-sending.service.ts`:
  - imports: `ProposalApprovalsRepository`, `deriveApprovalState` + `type ApprovalState`, `proposalApprovalEvent` + `PROPOSAL_EVENT` (already has `proposalSentEvent` from the same module), `ApprovalRequiredError`.
  - add exported types:
```ts
export interface SendStateApproval {
  state: ApprovalState;
  required: boolean;
  creatorName: string | null;
  current: {
    id: string;
    versionNumber: number;
    requestedAt: Date;
    requestedByName: string;
    decision: "APPROVED" | "CHANGES_REQUESTED" | null;
    decidedAt: Date | null;
    message: string | null;
  } | null;
}
```
  `SendState` gains `approval: SendStateApproval;`; `PublicationHistoryItem` gains `approvedByName: string | null; sentWithoutApproval: boolean;`.
  - `publish` signature: add `options: { withoutApproval?: boolean } = {}` as the 5th parameter. After the idempotency short-circuit and before `const opportunity = …`, insert:
```ts
      // Spec D §4.5: approval gate (after the idempotent no-op, so re-sending an already-published version never asks).
      const access = await ProposalApprovalsRepository.creatorAccessForProposalWithTx(tx, organizationId, proposalId);
      const latestApproval = access?.hasAccess ? await ProposalApprovalsRepository.findLatestWithTx(tx, organizationId, proposalId) : null;
      const approvalState = deriveApprovalState({
        required: access?.hasAccess ?? false,
        latestVersionNumber: latestVersion.versionNumber,
        latest: latestApproval,
      });
      let approvalId: string | null = null;
      let sentWithoutApproval = false;
      if (approvalState === "approved") {
        approvalId = latestApproval!.id;
      } else if (approvalState !== "not_required") {
        if (!options.withoutApproval) throw new ApprovalRequiredError();
        sentWithoutApproval = true;
      }
```
    pass `approvalId, sentWithoutApproval` to `ProposalPublicationsRepository.insertWithTx`, and after the existing `proposalSentEvent` append:
```ts
      if (sentWithoutApproval && access) {
        await DomainEventsRepository.appendWithTx(
          tx,
          organizationId,
          proposalApprovalEvent({
            eventType: PROPOSAL_EVENT.SENT_WITHOUT_APPROVAL,
            proposalId,
            proposalTitle: proposal.title,
            opportunityId: proposal.opportunityId,
            versionNumber: publication.versionNumber,
            approvalId: null,
            publicationId: publication.id,
            creatorDisplayName: access.creatorDisplayName,
            userId,
          }),
        );
      }
```
  - `getSendState`: inside the same repeatable-read transaction, after `latestVersion`:
```ts
        const access = await ProposalApprovalsRepository.creatorAccessForProposalWithTx(tx, organizationId, proposalId);
        const current = access?.hasAccess
          ? await ProposalApprovalsRepository.findLatestWithRequesterWithTx(tx, organizationId, proposalId)
          : null;
        const approval: SendStateApproval = {
          state: deriveApprovalState({
            required: access?.hasAccess ?? false,
            latestVersionNumber: latestVersion?.versionNumber ?? 0,
            latest: current?.approval ?? null,
          }),
          required: access?.hasAccess ?? false,
          creatorName: access?.creatorDisplayName ?? null,
          current: current
            ? {
                id: current.approval.id,
                versionNumber: current.approval.versionNumber,
                requestedAt: current.approval.requestedAt,
                requestedByName: current.requestedByName,
                decision: current.approval.decision,
                decidedAt: current.approval.decidedAt,
                message: current.approval.message,
              }
            : null,
        };
```
    and include `approval` in the returned object.
  - `listPublications` maps `approvedByName` and `publication.sentWithoutApproval`.
- [ ] **Step 4:** Run `src/services/proposal-sending.service.test.ts` and every test file touching publications (`/opt/homebrew/bin/pnpm vitest run src/services src/repositories --testTimeout=60000 --hookTimeout=60000`) — PASS. Existing assertions like `expect(state).toMatchObject({...})` keep passing; fix any `toEqual` on the whole send-state/history object by adding the new fields. `tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(proposals): approval gate on publish and approval in send-state`.

---

### Task 4: Notifications for approval events

**Files:**
- Modify: `src/repositories/notifications.repository.ts`, `src/services/event-handlers/proposal-notifications.ts`
- Test: the existing tests next to them (`notifications.repository.test.ts`, `proposal-notifications.test.ts` or wherever `notificationCopy`/handlers are tested — grep `notificationCopy`)

**Interfaces — Consumes:** `PROPOSAL_EVENT` (Task 2). **Produces:** `FanOutAudience { creatorUserId: string | null; only?: "staff" | "creator" }`; handlers registered for the four new event types.

- [ ] **Step 1: Failing tests.**
  - Repository: seed an org with OWNER, a MANAGER member and two CREATOR members (A = target, B = other); `fanOutWithTx(..., { creatorUserId: A, only: "creator" })` inserts exactly one row for A; `{ creatorUserId: A, only: "staff" }` inserts rows for OWNER and MANAGER only; `{ creatorUserId: null, only: "creator" }` inserts 0; default (no `only`) unchanged (OWNER, MANAGER, A).
  - Handler: for each of the four event types build a `DomainEvent`-shaped object with payload `{ proposal_id, proposal_title: "Campanha Verão", creator_display_name: "Thais", ... }` and assert `notificationCopy(event)` returns exactly:
    - `proposal.approval_requested` → `{ kind, title: "Aprovação pedida", body: 'Revise e aprove "Campanha Verão".', linkPath: "/proposals/<id>" }`
    - `proposal.creator_approved` → `title: "Creator aprovou"`, `body: 'Thais aprovou "Campanha Verão".'`
    - `proposal.creator_changes_requested` → `title: "Creator pediu ajustes"`, `body: 'Thais pediu ajustes em "Campanha Verão".'`
    - `proposal.sent_without_approval` → `title: "Enviada sem sua aprovação"`, `body: '"Campanha Verão" foi enviada ao cliente sem sua aprovação.'`
  - End-to-end through the drain: with the creator holding a CREATOR membership, `ProposalApprovalService.request` then drain (use the existing drain test helper/pattern, grep `EventDrainService` in tests) → notifications exist only for the creator's user; `approve` then drain → only OWNER (and MANAGER if seeded) get "Creator aprovou".
  Run — FAIL.
- [ ] **Step 2: Implement audience.** In `notifications.repository.ts`:
```ts
export interface FanOutAudience {
  creatorUserId: string | null;
  /** "staff": OWNER/MANAGER only. "creator": the owning creator only. Omitted: staff + owning creator. */
  only?: "staff" | "creator";
}
```
  and at the top of `fanOutWithTx`:
```ts
    if (audience.only === "creator" && !audience.creatorUserId) return 0;
    const staff = inArray(organizationMembers.role, ["OWNER", "MANAGER"]);
    const owningCreator = audience.creatorUserId
      ? and(eq(organizationMembers.role, "CREATOR"), eq(organizationMembers.userId, audience.creatorUserId))
      : undefined;
    const roleCondition =
      audience.only === "staff" ? staff : audience.only === "creator" ? owningCreator! : owningCreator ? or(staff, owningCreator) : staff;
```
  replacing the previous `roleCondition` computation.
- [ ] **Step 3: Implement handlers.** In `proposal-notifications.ts`:
```ts
type Audience = "staff" | "creator";

const APPROVAL_COPY: Record<string, { title: string; body: (p: { proposal_title: string; creator_display_name: string }) => string; audience: Audience }> = {
  [PROPOSAL_EVENT.APPROVAL_REQUESTED]: { title: "Aprovação pedida", body: (p) => `Revise e aprove "${p.proposal_title}".`, audience: "creator" },
  [PROPOSAL_EVENT.CREATOR_APPROVED]: { title: "Creator aprovou", body: (p) => `${p.creator_display_name} aprovou "${p.proposal_title}".`, audience: "staff" },
  [PROPOSAL_EVENT.CREATOR_CHANGES_REQUESTED]: {
    title: "Creator pediu ajustes",
    body: (p) => `${p.creator_display_name} pediu ajustes em "${p.proposal_title}".`,
    audience: "staff",
  },
  [PROPOSAL_EVENT.SENT_WITHOUT_APPROVAL]: {
    title: "Enviada sem sua aprovação",
    body: (p) => `"${p.proposal_title}" foi enviada ao cliente sem sua aprovação.`,
    audience: "creator",
  },
};
```
  Extend `notificationCopy` so that when `APPROVAL_COPY[event.eventType]` exists it returns `{ kind: event.eventType, title, body: body(payload), linkPath: \`/proposals/${payload.proposal_id}\` }` (existing COPY path unchanged). Extract the creator-user lookup already inside `notify` into `async function owningCreatorUserId(tx, event): Promise<string | null>` and add:
```ts
const notifyApproval: EventHandler = async (tx, event) => {
  const copy = notificationCopy(event);
  const config = APPROVAL_COPY[event.eventType];
  if (!copy || !config) return;
  const creatorUserId = await owningCreatorUserId(tx, event);
  await NotificationsRepository.fanOutWithTx(tx, event.organizationId, { sourceEventId: event.id, ...copy }, { creatorUserId, only: config.audience });
};
```
  and register the four event types → `notifyApproval` in `proposalNotificationHandlers`.
- [ ] **Step 4:** Run the notification/handler/drain tests — PASS; `tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(notifications): creator approval notifications with creator/staff audiences`.

---

### Task 5: API routes

**Files:**
- Create: `src/app/api/proposals/[id]/approval/route.ts` (+ `route.test.ts`), `src/app/api/proposals/[id]/approval/approve/route.ts` (+ test), `src/app/api/proposals/[id]/approval/request-changes/route.ts` (+ test)
- Modify: `src/app/api/proposals/[id]/publications/route.ts` (+ its test), `src/app/api/write-guard.test.ts`, `src/app/api/id-guard.test.ts` (if it enumerates `[id]` routes — grep; add the three new ones the same way spec C added its routes)

**Interfaces — Consumes:** Tasks 2–3 service methods and errors.

- [ ] **Step 1: Failing route tests.** Use `withTestDb`, `seedProposal`, `importRouteWithSession`, `ownerSession`, `creatorSession` (see `src/app/api/creators/[id]/access/route.test.ts` for the pattern). Give the creator a CREATOR membership in setup. Cases:
  - `POST /approval`: OWNER → 201 `{ approval: { requestNumber: 1 } }`, again → 200; CREATOR session → 403; creator without access → 409 `{ error: "Este creator não tem acesso ao PublyFlow; envie direto." }`; malformed id → 404.
  - `POST /approval/approve`: owning creator (`creatorSession(org, creator.userId, creator.id)`) after a request → 200 `{ approval: { decision: "APPROVED" } }`; OWNER → 403 `{ error: "Somente o creator pode aprovar." }`; another creator of the same org (onboard a second creator via `CreatorService.onboardCreator` + membership) → 404; no request → 409 `{ error: "Não há pedido de aprovação pendente." }`; after an edit → 409 `{ error: "A proposta mudou depois do pedido de aprovação." }`; message of 2001 chars → 400.
  - `POST /approval/request-changes`: owning creator, `{ message: "Trocar capa" }` → 200 `{ approval: { decision: "CHANGES_REQUESTED", message: "Trocar capa" } }`; `{ message: "   " }` → 400 `{ errors: { message: ["Descreva os ajustes."] } }`; OWNER → 403.
  - `POST /publications`: with access and no approval → 409 `{ error: "Aguardando aprovação do creator.", code: "APPROVAL_REQUIRED" }`; body `{ withoutApproval: true }` → 201 and `publication.sentWithoutApproval === true`; no body when not required → 201 as before.
  - Deadlock: mock `@/services/proposal-approval.service` (via `extraMocks` + `vi.doMock`, as in `src/app/api/creators/[id]/access/route.test.ts`) so `request` rejects with `Object.assign(new Error("deadlock"), { code: "40P01" })` → 409 `{ error: "Não foi possível salvar agora. Tente novamente." }`.
  Run — FAIL.
- [ ] **Step 2: Request route** `src/app/api/proposals/[id]/approval/route.ts`:
```ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { ProposalApprovalService } from "@/services/proposal-approval.service";
import {
  ApprovalNotRequiredError,
  ProposalArchivedError,
  ProposalNotFoundError,
  UserNotOrganizationMemberError,
} from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { denyCreatorWrite } from "@/lib/auth/access";
import { scheduleEventDrain } from "@/lib/events/schedule-drain";
import { isUuid } from "@/lib/uuid";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const notFound = () => NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  if (!isUuid(id)) return notFound();

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  try {
    const result = await ProposalApprovalService.request(db, session.organizationId, id, session.userId);
    if (result.created) scheduleEventDrain();
    return NextResponse.json({ approval: result.approval }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ProposalNotFoundError) return notFound();
    if (error instanceof ProposalArchivedError) {
      return NextResponse.json({ error: error.message, code: "PROPOSAL_ARCHIVED" }, { status: 409 });
    }
    if (error instanceof ApprovalNotRequiredError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof UserNotOrganizationMemberError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
    throw error;
  }
}
```
- [ ] **Step 3: Shared creator-decision handler** `src/app/api/proposals/[id]/approval/decision.ts` (not a route file):
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import type { ProposalApproval } from "@/repositories/proposal-approvals.repository";
import {
  ApprovalStaleError,
  NoPendingApprovalError,
  NotProposalCreatorError,
  ProposalNotFoundError,
} from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isCreator } from "@/lib/auth/access";
import { proposalOutOfScope } from "@/lib/auth/proposal-scope";
import { scheduleEventDrain } from "@/lib/events/schedule-drain";
import { isUuid } from "@/lib/uuid";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

const TOO_LONG = "Use no máximo 2000 caracteres.";
export const approveSchema = z.object({ message: z.string().trim().max(2000, TOO_LONG).optional() });
export const requestChangesSchema = z.object({ message: z.string().trim().min(1, "Descreva os ajustes.").max(2000, TOO_LONG) });

/**
 * Creator-only write (spec D §4.4) — exempt from denyCreatorWrite on purpose;
 * the allowlist in write-guard.test.ts names both routes.
 */
export async function handleCreatorDecision<S extends z.ZodType<{ message?: string }>>(
  request: Request,
  params: Promise<{ id: string }>,
  schema: S,
  run: (organizationId: string, proposalId: string, userId: string, message: string | null) => Promise<ProposalApproval>,
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const notFound = () => NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  if (!isUuid(id)) return notFound();
  if (!isCreator(session)) return NextResponse.json({ error: "Somente o creator pode aprovar." }, { status: 403 });
  if (await proposalOutOfScope(db, session, id)) return notFound();

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    const approval = await run(session.organizationId, id, session.userId, parsed.data.message ?? null);
    scheduleEventDrain();
    return NextResponse.json({ approval }, { status: 200 });
  } catch (error) {
    if (error instanceof ProposalNotFoundError) return notFound();
    if (error instanceof NotProposalCreatorError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof NoPendingApprovalError || error instanceof ApprovalStaleError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
    throw error;
  }
}
```
  `src/app/api/proposals/[id]/approval/approve/route.ts`:
```ts
import { db } from "@/db";
import { ProposalApprovalService } from "@/services/proposal-approval.service";
import { approveSchema, handleCreatorDecision } from "../decision";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleCreatorDecision(request, params, approveSchema, (organizationId, proposalId, userId, message) =>
    ProposalApprovalService.approve(db, organizationId, proposalId, userId, message),
  );
}
```
  `src/app/api/proposals/[id]/approval/request-changes/route.ts`:
```ts
import { db } from "@/db";
import { ProposalApprovalService } from "@/services/proposal-approval.service";
import { handleCreatorDecision, requestChangesSchema } from "../decision";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleCreatorDecision(request, params, requestChangesSchema, (organizationId, proposalId, userId, message) =>
    ProposalApprovalService.requestChanges(db, organizationId, proposalId, userId, message ?? ""),
  );
}
```
  If the generic signature fights zod 4 typing, type `schema` as `typeof approveSchema | typeof requestChangesSchema` instead.
- [ ] **Step 4: Publications route.** In `POST` of `src/app/api/proposals/[id]/publications/route.ts`: rename `_request` → `request`; after `denyCreatorWrite`:
```ts
  const body = (await request.json().catch(() => null)) as { withoutApproval?: unknown } | null;
  const withoutApproval = body?.withoutApproval === true;
```
  pass `{ withoutApproval }` as the 5th argument to `publish`, and add in the catch before `throw error`:
```ts
    if (error instanceof ApprovalRequiredError) {
      return NextResponse.json({ error: error.message, code: "APPROVAL_REQUIRED" }, { status: 409 });
    }
```
- [ ] **Step 5: Write guard.** In `src/app/api/write-guard.test.ts` add to `ALLOWLIST` (with a trailing comment `// spec D: creator decides on approval`): `"proposals/[id]/approval/approve/route.ts POST"`, `"proposals/[id]/approval/request-changes/route.ts POST"`. The request route calls `denyCreatorWrite(`, so it needs no entry. Confirm `decision.ts` isn't picked up (the guard only scans files named `route.ts`).
- [ ] **Step 6:** Run `src/app/api/proposals src/app/api/write-guard.test.ts src/app/api/id-guard.test.ts` — PASS; `tsc --noEmit` clean.
- [ ] **Step 7: Commit** `feat(api): proposal approval routes and publish withoutApproval`.

---

### Task 6: Agency UI — hooks, send panel, history

**Files:**
- Modify: `src/hooks/use-proposal-sending.ts` (+ its test if present), `src/components/proposals/proposal-send-panel.tsx` (+ test), `src/components/proposals/proposal-send-history.tsx` (+ test)

**Interfaces — Produces (used by Task 7):**
```ts
export type ApprovalStateDto = "not_required" | "none" | "pending" | "approved" | "changes_requested" | "stale";
export interface SendStateApprovalDto { state: ApprovalStateDto; required: boolean; creatorName: string | null; current: { id: string; versionNumber: number; requestedAt: string; requestedByName: string; decision: "APPROVED" | "CHANGES_REQUESTED" | null; decidedAt: string | null; message: string | null } | null }
SendStateDto.approval: SendStateApprovalDto
PublicationHistoryItemDto.approvedByName: string | null; .sentWithoutApproval: boolean
useRequestApproval(proposalId): UseMutationResult<{ approval: unknown }, ApiError, void>
useApproveProposal(proposalId): UseMutationResult<{ approval: unknown }, ApiError, { message?: string }>
useRequestProposalChanges(proposalId): UseMutationResult<{ approval: unknown }, ApiError, { message: string }>
usePublishProposal(proposalId): UseMutationResult<PublishResultDto, ApiError, { withoutApproval?: boolean } | void>
```

- [ ] **Step 1: Hooks.** Add the DTO types above. Change `usePublishProposal`:
```ts
    mutationFn: (variables: { withoutApproval?: boolean } | void) =>
      apiFetch<PublishResultDto>(`/api/proposals/${proposalId}/publications`, {
        method: "POST",
        body: JSON.stringify({ withoutApproval: variables?.withoutApproval === true }),
      }),
```
  (check how `apiFetch` sets JSON headers — follow how other hooks send bodies, e.g. `useInviteCreator` / `useUpdateCreator`), and `onError: (error) => toast.error(error instanceof ApiError && error.status === 409 ? error.message : "Não foi possível enviar a proposta. Tente novamente.")`. Add a helper to invalidate send-state + publications and three mutations:
```ts
function useApprovalMutation<V>(proposalId: string, path: string, successToast: string) {
  const queryClient = useQueryClient();
  return useMutation<{ approval: unknown }, ApiError, V>({
    mutationFn: (variables: V) =>
      apiFetch<{ approval: unknown }>(`/api/proposals/${proposalId}/${path}`, {
        method: "POST",
        body: JSON.stringify(variables ?? {}),
      }),
    onSuccess: () => toast.success(successToast),
    onError: (error) => toast.error(error.status === 409 || error.status === 400 ? error.message : "Não foi possível concluir. Tente novamente."),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: proposalSendStateQueryKey(proposalId) });
      queryClient.invalidateQueries({ queryKey: proposalPublicationsQueryKey(proposalId) });
    },
  });
}

export const useRequestApproval = (proposalId: string) => useApprovalMutation<void>(proposalId, "approval", "Pedido de aprovação enviado.");
export const useApproveProposal = (proposalId: string) =>
  useApprovalMutation<{ message?: string }>(proposalId, "approval/approve", "Proposta aprovada.");
export const useRequestProposalChanges = (proposalId: string) =>
  useApprovalMutation<{ message: string }>(proposalId, "approval/request-changes", "Pedido de ajustes enviado.");
```
  For a 400 from request-changes the server body is `{ errors: { message: [...] } }`; if `ApiError.message` doesn't carry it, show "Descreva os ajustes." (the dialog in Task 7 also blocks empty input client-side).

- [ ] **Step 2: Failing panel tests** (mock the hooks as the existing `proposal-send-panel.test.tsx` does; build `approval` per case):
  - `not_required` → no approval text; "Enviar proposta" enabled as today.
  - `none` → text "Este creator precisa aprovar a proposta antes do envio."; buttons "Pedir aprovação" and "Enviar sem aprovação"; the main send button is **not** rendered.
  - `pending` (versionNumber 2, creatorName "Thais") → "Aguardando aprovação de Thais (versão 2)."; only "Enviar sem aprovação".
  - `approved` (decidedAt 2026-09-29T15:00:00Z) → text starts "Aprovada por Thais em"; main send button enabled; no "Enviar sem aprovação".
  - `changes_requested` (message "Trocar a capa") → "Thais pediu ajustes:" and "Trocar a capa"; "Pedir aprovação" · "Enviar sem aprovação".
  - `stale` → "A proposta mudou depois do pedido de aprovação."; "Pedir aprovação" · "Enviar sem aprovação".
  - Clicking "Enviar sem aprovação" opens AlertDialog titled "Enviar sem aprovação" with body "Thais ainda não aprovou esta versão. A proposta será enviada ao cliente e Thais será avisado(a)."; confirming calls publish `mutate({ withoutApproval: true }, …)`.
  - Clicking "Pedir aprovação" calls the request mutation.
  - While a mutation `isPending`, approval buttons are disabled.
  - The approval block renders only when `state.canSend` is true (nothing to send → no block).
  Run — FAIL.
- [ ] **Step 3: Implement the panel block.** In `proposal-send-panel.tsx` add `useRequestApproval` and state `const [confirmWithoutApproval, setConfirmWithoutApproval] = React.useState(false);`. Compute:
```ts
  const approval = state.approval;
  const gated = approval.required && state.canSend && approval.state !== "approved";
  const creatorName = approval.creatorName ?? "O creator";
  const busy = publish.isPending || requestApproval.isPending || checking;
```
  Render, above the existing buttons row, when `approval.required && state.canSend`:
```tsx
        <div className="flex flex-col gap-2" aria-label="Aprovação do creator">
          <h2 className="text-sm font-semibold">Aprovação do creator</h2>
          {approval.state === "none" ? <p className="text-sm text-muted-foreground">Este creator precisa aprovar a proposta antes do envio.</p> : null}
          {approval.state === "pending" && approval.current ? (
            <p className="text-sm text-muted-foreground">Aguardando aprovação de {creatorName} (versão {approval.current.versionNumber}).</p>
          ) : null}
          {approval.state === "approved" && approval.current?.decidedAt ? (
            <p className="text-sm text-muted-foreground">Aprovada por {creatorName} em {formatDateTime(new Date(approval.current.decidedAt))}.</p>
          ) : null}
          {approval.state === "changes_requested" && approval.current ? (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-muted-foreground">{creatorName} pediu ajustes:</p>
              <blockquote className="whitespace-pre-line border-l-2 border-border pl-3">{approval.current.message}</blockquote>
            </div>
          ) : null}
          {approval.state === "stale" ? <p className="text-sm text-warning">A proposta mudou depois do pedido de aprovação.</p> : null}
          {gated ? (
            <div className="flex flex-wrap gap-2">
              {approval.state !== "pending" ? (
                <Button type="button" size="sm" disabled={busy} onClick={() => requestApproval.mutate()}>
                  Pedir aprovação
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmWithoutApproval(true)}>
                Enviar sem aprovação
              </Button>
            </div>
          ) : null}
        </div>
```
  Hide the main send button when `gated` (`{gated ? null : <Button …>…</Button>}`), keep the link/share buttons. Add the AlertDialog:
```tsx
      <AlertDialog open={confirmWithoutApproval} onOpenChange={setConfirmWithoutApproval}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar sem aprovação</AlertDialogTitle>
            <AlertDialogDescription>
              {creatorName} ainda não aprovou esta versão. A proposta será enviada ao cliente e {creatorName} será avisado(a).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  setConfirmWithoutApproval(false);
                  publish.mutate({ withoutApproval: true }, { onSuccess: (result) => setSentPath(result.publicPath) });
                }}
              >
                Enviar sem aprovação
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```
  Keep `send()` calling `publish.mutate(undefined, …)`.
- [ ] **Step 4: History.** In `proposal-send-history.tsx`, append to each line: ` · aprovada por {approvedByName}` when `item.approvedByName`, or ` · enviada sem aprovação` when `item.sentWithoutApproval`. Test both labels plus a legacy item (both absent → unchanged text).
- [ ] **Step 5:** Run the hook/panel/history tests and `src/app/(app)/proposals` tests — PASS; `tsc --noEmit` clean; fix any test fixtures of `SendStateDto` that now need `approval` (use `{ state: "not_required", required: false, creatorName: "Thais", current: null }`).
- [ ] **Step 6: Commit** `feat(proposals): approval block in the agency send panel`.

---

### Task 7: Creator UI — approval block in ProposalReadView

**Files:**
- Create: `src/components/proposals/proposal-approval-block.tsx`, `src/components/proposals/proposal-approval-block.test.tsx`
- Modify: `src/components/proposals/proposal-read-view.tsx` (+ its test)

**Interfaces — Consumes:** Task 6 hooks and DTOs.

- [ ] **Step 1: Failing tests** for `ProposalApprovalBlock({ proposalId, approval }: { proposalId: string; approval: SendStateApprovalDto })` (mock `@/hooks/use-proposal-sending`):
  - `required: false` or state `none`/`not_required` → renders nothing.
  - `pending` (requestedByName "Owner") → "Owner pediu sua aprovação desta versão." + buttons "Aprovar", "Pedir ajustes".
  - "Aprovar" → AlertDialog "Aprovar proposta" / "A agência poderá enviar esta versão ao cliente." / "Cancelar" · "Aprovar"; confirming calls approve `mutate({})`.
  - "Pedir ajustes" → Dialog with textarea labelled "O que precisa mudar?"; "Enviar pedido" disabled while the trimmed text is empty; typing "Trocar a capa" and submitting calls `mutate({ message: "Trocar a capa" })`.
  - `approved` (decidedAt set) → text starts "Você aprovou esta versão em".
  - `changes_requested` → "Você pediu ajustes em …:" + the message.
  - `stale` → "A proposta mudou depois do pedido. Aguarde um novo pedido da agência."
  - Buttons disabled while either mutation `isPending`.
  - ReadView: renders the block when `state.approval.required` (mock the block to a marker and assert it receives the approval).
  Run — FAIL.
- [ ] **Step 2: Implement** `proposal-approval-block.tsx`:
```tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useApproveProposal, useRequestProposalChanges, type SendStateApprovalDto } from "@/hooks/use-proposal-sending";
import { formatDateTime } from "@/lib/presentation/format";

/** Spec D §7.2: the creator's side of the approval. */
export function ProposalApprovalBlock({ proposalId, approval }: { proposalId: string; approval: SendStateApprovalDto }) {
  const approve = useApproveProposal(proposalId);
  const requestChanges = useRequestProposalChanges(proposalId);
  const [confirmApprove, setConfirmApprove] = React.useState(false);
  const [changesOpen, setChangesOpen] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const busy = approve.isPending || requestChanges.isPending;

  if (!approval.required || !approval.current || approval.state === "none" || approval.state === "not_required") return null;
  const current = approval.current;

  return (
    <section aria-label="Aprovação" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Aprovação</h2>
      {approval.state === "pending" ? (
        <>
          <p className="text-sm text-muted-foreground">{current.requestedByName} pediu sua aprovação desta versão.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => setConfirmApprove(true)}>
              Aprovar
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setChangesOpen(true)}>
              Pedir ajustes
            </Button>
          </div>
        </>
      ) : null}
      {approval.state === "approved" && current.decidedAt ? (
        <p className="text-sm text-muted-foreground">Você aprovou esta versão em {formatDateTime(new Date(current.decidedAt))}.</p>
      ) : null}
      {approval.state === "changes_requested" && current.decidedAt ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-muted-foreground">Você pediu ajustes em {formatDateTime(new Date(current.decidedAt))}:</p>
          <blockquote className="whitespace-pre-line border-l-2 border-border pl-3">{current.message}</blockquote>
        </div>
      ) : null}
      {approval.state === "stale" ? (
        <p className="text-sm text-warning">A proposta mudou depois do pedido. Aguarde um novo pedido da agência.</p>
      ) : null}

      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar proposta</AlertDialogTitle>
            <AlertDialogDescription>A agência poderá enviar esta versão ao cliente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={busy}
                onClick={() => {
                  setConfirmApprove(false);
                  approve.mutate({});
                }}
              >
                Aprovar
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={changesOpen} onOpenChange={setChangesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pedir ajustes</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = message.trim();
              if (!trimmed) return;
              requestChanges.mutate(
                { message: trimmed },
                {
                  onSuccess: () => {
                    setChangesOpen(false);
                    setMessage("");
                  },
                },
              );
            }}
          >
            <Label htmlFor="approval-changes">O que precisa mudar?</Label>
            <Textarea id="approval-changes" value={message} maxLength={2000} onChange={(event) => setMessage(event.target.value)} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setChangesOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy || message.trim().length === 0}>
                Enviar pedido
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
```
  If `@/components/ui/textarea` or `label` doesn't exist, use what the codebase uses for textareas/labels (grep `Textarea`; `access-instructions-dialog.tsx` uses a textarea).
  In `proposal-read-view.tsx`, render `{state?.approval?.required ? <ProposalApprovalBlock proposalId={proposalId} approval={state.approval} /> : null}` between the header row and the link buttons.
- [ ] **Step 3:** Run the block + read-view tests — PASS; run the full suite once (`/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000`) and the build (`OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build`) — both green.
- [ ] **Step 4: Commit** `feat(proposals): creator approval block in the read view`.

---

## Real verification (controller + user, after Task 7)

Local dev DB (`publyflow`) already has org "PublyFlow Dev", the OWNER, creator "Creator Teste" (devandanalytics@gmail.com, access revoked in spec C) and "Proposta Marca Teste — Reels". The controller applies migration 0021 to `publyflow` (Task 1) and starts the worktree dev server.
1. OWNER (browser pane) re-invites "Creator Teste" on /creators.
2. OWNER opens the proposal → approval block shows "Este creator precisa aprovar…" → "Pedir aprovação".
3. User (incognito, Google devandanalytics) → bell shows "Aprovação pedida" → proposal shows "Owner pediu sua aprovação…" → "Aprovar".
4. OWNER → "Aprovada por Creator Teste em …" → Enviar → history "aprovada por Creator Teste".
5. OWNER edits the proposal (title) → block shows "A proposta mudou depois do pedido de aprovação." → "Pedir aprovação".
6. Creator → "Pedir ajustes" with text → OWNER bell "Creator pediu ajustes" and panel shows the message.
7. OWNER → "Enviar sem aprovação" → confirm → history "enviada sem aprovação"; creator bell "Enviada sem sua aprovação".
8. OWNER revokes the creator → panel shows no approval block; send works directly.

## Deploy

1. Controller applies 0021 to production (`set -a; . ./.env.production.local; set +a; /opt/homebrew/bin/pnpm drizzle-kit migrate`) after a read-only check of `drizzle.__drizzle_migrations` (expect 21 rows before, 22 after).
2. User pushes `main`.
