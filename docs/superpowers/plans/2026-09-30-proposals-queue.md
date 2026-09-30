# /proposals Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 404 at `/proposals` with a queue of the organization's (or the creator's) proposals grouped by a server-computed situation.

**Architecture:** A pure `deriveQueueSituation` maps the existing send flags (`computeSendFlags`) and approval state (`deriveApprovalState`) to one of seven situations. `ProposalQueueService.list` loads up to 200 scoped proposals and their latest version / publication+response / approval / item totals / creator access in set-based queries inside one REPEATABLE READ transaction and returns `QueueItem`s. `GET /api/proposals/queue` exposes it; the page groups items by role-specific order and labels built in a pure `queue-labels` module.

**Tech Stack:** Next.js 16 App Router, React 19 + TanStack Query, Drizzle ORM + Postgres, zod 4, Vitest (+ Testing Library, jsdom).

Spec: `docs/superpowers/specs/2026-09-30-proposals-queue-design.md`.

## Global Constraints

- Situation computed **only on the server**; no proposal creation and no write actions on the page.
- The app role bypasses RLS: **every query carries an explicit `organization_id` predicate**, including joins.
- CREATOR scope: only proposals whose opportunity `creator_id = session.creatorId`; a CREATOR session with `creatorId = null` gets an empty result.
- Limit: at most 200 proposals, ordered by `proposals.created_at desc`; `truncated = true` when a 201st exists. Archived excluded unless `includeArchived=1` (the only accepted value).
- `closedCount` = number of `closed` items in the returned set (the V1 UI doesn't use it).
- Situations: `changes_requested | ready_to_send | awaiting_creator | draft | awaiting_client | closed | archived` (rules in spec §3, first match wins).
- OWNER/MANAGER group order and labels: Ajustes pedidos, Pronta para enviar, Aguardando creator, Rascunho, Aguardando cliente, Fechadas. CREATOR: Aguardando sua aprovação (awaiting_creator), Em ajustes (changes_requested), Com a agência (ready_to_send + draft), Aguardando cliente, Fechadas. Archived (both): last group "Arquivadas", only when shown.
- Copy (exact): heading "Propostas"; group heading `{label} ({count})`; toggle "Mostrar arquivadas" / "Ocultar arquivadas"; truncated note "Mostrando as 200 propostas mais recentes."; empty state title "Nenhuma proposta ainda." description "Propostas são criadas a partir de uma oportunidade no Pipeline." action "Ir para o Pipeline" → `/pipeline`; loading "Carregando..."; error "Não foi possível carregar as propostas." + "Tentar novamente". Detail lines per spec §5 table.
- **Hard DB rule for implementers:** never start/stop/restart Docker containers, never run drizzle-kit, never create/drop databases, never run psql. If the test DB fails in any way, STOP and report BLOCKED. Don't start dev servers.
- Commands: `/opt/homebrew/bin/pnpm vitest run <paths> --testTimeout=60000 --hookTimeout=60000`; `/opt/homebrew/bin/pnpm tsc --noEmit`. Plain commands only; never bare `git stash`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/proposals/queue-situation.ts` (+test) | `QueueSituation`, pure `deriveQueueSituation` |
| `src/services/proposal-queue.service.ts` (+test) | set-based load + `QueueItem` assembly |
| `src/app/api/proposals/queue/route.ts` (+test) | `GET` with session/scope/`includeArchived` |
| `src/lib/proposals/queue-labels.ts` (+test) | role group config, detail line text |
| `src/hooks/use-proposal-queue.ts` | query hook + DTOs |
| `src/app/(app)/proposals/page.tsx` (+test) | page |

---

### Task 1: `deriveQueueSituation`

**Files:** Create `src/lib/proposals/queue-situation.ts`, `src/lib/proposals/queue-situation.test.ts`.

**Interfaces — Produces:**
```ts
export type QueueSituation = "changes_requested" | "ready_to_send" | "awaiting_creator" | "draft" | "awaiting_client" | "closed" | "archived";
export function deriveQueueSituation(input: {
  status: ProposalStatus; // from "@/lib/proposal-themes"
  hasUnsentChanges: boolean;
  canSend: boolean;
  approvalState: ApprovalState; // from "@/lib/proposals/approval-state"
  hasPublication: boolean;
}): QueueSituation;
```

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { deriveQueueSituation } from "./queue-situation";
import { computeSendFlags } from "@/services/proposal-sending.service";
import type { ProposalStatus } from "@/lib/proposal-themes";
import type { ApprovalState } from "./approval-state";

function situation(status: ProposalStatus, latest: number, published: number | null, approvalState: ApprovalState) {
  const flags = computeSendFlags({ status, latestVersionNumber: latest, latestPublicationVersionNumber: published });
  return deriveQueueSituation({ status, ...flags, approvalState, hasPublication: published !== null });
}

describe("deriveQueueSituation (spec §3)", () => {
  it.each([
    // [status, latestVersion, publishedVersion, approvalState, expected]
    ["ARCHIVED", 2, 1, "not_required", "archived"],
    ["ARCHIVED", 2, null, "changes_requested", "archived"],
    ["DRAFT", 1, null, "changes_requested", "changes_requested"],
    ["CHANGES_REQUESTED", 2, 2, "not_required", "changes_requested"],
    ["CHANGES_REQUESTED", 3, 2, "not_required", "ready_to_send"],
    ["CHANGES_REQUESTED", 3, 2, "pending", "awaiting_creator"],
    ["CHANGES_REQUESTED", 3, 2, "none", "draft"],
    ["DRAFT", 1, null, "approved", "ready_to_send"],
    ["SENT", 3, 2, "not_required", "ready_to_send"],
    ["DRAFT", 1, null, "not_required", "draft"],
    ["DRAFT", 1, null, "pending", "awaiting_creator"],
    ["DRAFT", 2, null, "stale", "draft"],
    ["DRAFT", 1, null, "none", "draft"],
    ["SENT", 2, 2, "not_required", "awaiting_client"],
    ["SENT", 2, 2, "stale", "awaiting_client"],
    ["APPROVED", 2, 2, "not_required", "closed"],
    ["REJECTED", 2, 2, "approved", "closed"],
    ["APPROVED", 3, 2, "not_required", "ready_to_send"],
    ["REJECTED", 3, 2, "none", "draft"],
  ] as const)("%s v%s published v%s approval=%s → %s", (status, latest, published, approvalState, expected) => {
    expect(situation(status, latest, published, approvalState)).toBe(expected);
  });
});
```
Run `/opt/homebrew/bin/pnpm vitest run src/lib/proposals/queue-situation.test.ts --testTimeout=60000 --hookTimeout=60000` → FAIL (module missing).

- [ ] **Step 2: Implement**
```ts
import type { ProposalStatus } from "@/lib/proposal-themes";
import type { ApprovalState } from "./approval-state";

export type QueueSituation =
  | "changes_requested"
  | "ready_to_send"
  | "awaiting_creator"
  | "draft"
  | "awaiting_client"
  | "closed"
  | "archived";

/** Spec §3 — first match wins. */
export function deriveQueueSituation(input: {
  status: ProposalStatus;
  hasUnsentChanges: boolean;
  canSend: boolean;
  approvalState: ApprovalState;
  hasPublication: boolean;
}): QueueSituation {
  if (input.status === "ARCHIVED") return "archived";
  if (input.approvalState === "changes_requested") return "changes_requested";
  if (input.status === "CHANGES_REQUESTED" && !input.hasUnsentChanges) return "changes_requested";
  if (input.canSend) {
    if (input.approvalState === "approved") return "ready_to_send";
    if (input.approvalState === "not_required" && input.hasPublication) return "ready_to_send";
    if (input.approvalState === "pending") return "awaiting_creator";
    return "draft";
  }
  if (input.status === "SENT") return "awaiting_client";
  return "closed";
}
```
Note: the last `return "closed"` is reached only for APPROVED/REJECTED with nothing to send (DRAFT always has `canSend`; ARCHIVED returned earlier; CHANGES_REQUESTED without unsent changes returned earlier). Keep a comment saying so.

- [ ] **Step 3:** Run → PASS. `tsc --noEmit` clean.
- [ ] **Step 4: Commit** `feat(proposals): deriveQueueSituation`.

---

### Task 2: `ProposalQueueService.list`

**Files:** Create `src/services/proposal-queue.service.ts`, `src/services/proposal-queue.service.test.ts`.

**Interfaces — Consumes:** Task 1; `computeSendFlags` (`src/services/proposal-sending.service.ts`); `deriveApprovalState` (`src/lib/proposals/approval-state.ts`); `excerpt` (`src/lib/events/proposal-events.ts`); `runInTenantContext` (`src/repositories/tenant-context.ts`). **Produces:**
```ts
export const QUEUE_LIMIT = 200;
export interface QueueItem {
  id: string;
  title: string;
  situation: QueueSituation;
  creatorName: string;
  counterpartName: string | null;
  totalCents: number;
  lastActivityAt: Date;
  latestVersionNumber: number;
  latestPublication: { versionNumber: number; publishedAt: Date } | null;
  changes: { by: "client" | "creator"; name: string; excerpt: string } | null;
  approvedByCreator: boolean;
  approvalStale: boolean;
  clientOutcome: { action: "ACCEPT" | "REJECT"; name: string; at: Date } | null;
}
export interface QueueResult { items: QueueItem[]; closedCount: number; truncated: boolean }
ProposalQueueService.list(db, organizationId, options: { creatorScope: string | null; includeArchived: boolean }): Promise<QueueResult>
```

- [ ] **Step 1: Failing tests** (`withTestDb`, `seedProposal` from `src/test/helpers/proposal-fixtures.ts`; `ProposalService.update(db, org, id, { title | status, userId })` edits create versions; `ProposalSendingService.publish(db, org, id, userId, opts?)`; client responses: find the existing service used by `/api/public/...` response tests — grep `ProposalResponseService` in `src/services/proposal-response.service.ts` and use its public method the way its own tests do; creator approval: `ProposalApprovalService.request/approve/requestChanges(db, org, id, userId, [approvalId], [message])` — check the current signatures in `src/services/proposal-approval.service.ts` (decisions take the `approvalId`); CREATOR membership: `db.insert(organizationMembers).values({ organizationId, userId: creator.userId, role: "CREATOR" })`). Tests:
  1. **Situations & fields for a seeded mix in one org** — build proposals (each `seedProposal` creates its own org, so create extra proposals in the same org with `ProposalService.create(db, organization.id, { opportunityId: opportunity.id, title, theme: "PREMIUM", userId: owner.id })`):
     - A: fresh draft → `draft`, `latestPublication: null`, `latestVersionNumber: 1`, `changes: null`.
     - B: published → `awaiting_client`, `latestPublication.versionNumber === 1`.
     - C: published, then client requests changes with message "Trocar a capa" → `changes_requested`, `changes: { by: "client", name: <respondent name>, excerpt: "Trocar a capa" }`.
     - D: published, client accepts → `closed`, `clientOutcome.action === "ACCEPT"`.
     - E: archived → absent by default; with `includeArchived: true` present as `archived`.
     Assert `closedCount === 1`, `truncated === false`, items sorted by `lastActivityAt` desc, and `counterpartName === "Bella Cosméticos"` (the fixture's company) and `creatorName === "Thais"`.
  2. **Creator approval** — with a CREATOR membership: request → `awaiting_creator`; approve → `ready_to_send`, `approvedByCreator: true`; new request after an edit + requestChanges "Ajustar preço" → `changes_requested`, `changes: { by: "creator", name: "Thais", excerpt: "Ajustar preço" }`; edit after a pending request → `draft`, `approvalStale: true`.
  3. **Totals** — add items via the existing item service (grep `ProposalItemService` for its create method and signature) with quantity 2 × 150000 and 1 × 50000 → `totalCents === 350000`; a proposal without items → `0`.
  4. **Scope** — two creators in the same org (onboard a second with `CreatorService.onboardCreator` + its own opportunity/proposal): `creatorScope: creatorA.id` returns only A's proposals; `creatorScope: null` returns both.
  5. **Tenant isolation** — a proposal in another org (second `seedProposal`) never appears.
  6. **Limit** — create 201 proposals in one org (loop `ProposalService.create`; if too slow, lower via a module-level override is NOT allowed — keep 201 and give the test `{ timeout: 120000 }`) → `items.length === 200`, `truncated === true`, and the oldest-created proposal is the one missing.
  Run → FAIL.

- [ ] **Step 2: Implement** `src/services/proposal-queue.service.ts`:
```ts
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { proposals, proposalItems, proposalVersions, proposalPublications, proposalResponses, proposalApprovals } from "@/db/schema/proposals";
import { opportunities } from "@/db/schema/commercial-flow";
import { creators } from "@/db/schema/creators";
import { brands, companies } from "@/db/schema/companies-brands-contacts";
import { organizationMembers } from "@/db/schema/organizations";
import { computeSendFlags } from "./proposal-sending.service";
import { deriveApprovalState } from "@/lib/proposals/approval-state";
import { deriveQueueSituation, type QueueSituation } from "@/lib/proposals/queue-situation";
import { excerpt } from "@/lib/events/proposal-events";
import type { ProposalStatus } from "@/lib/proposal-themes";

export const QUEUE_LIMIT = 200;

// QueueItem / QueueResult as in the Interfaces block above.

type Tx = NodePgDatabase<typeof schema>;

export const ProposalQueueService = {
  async list(
    db: Tx,
    organizationId: string,
    options: { creatorScope: string | null; includeArchived: boolean },
  ): Promise<QueueResult> {
    return runInTenantContext(
      db,
      organizationId,
      async (tx) => {
        const conditions = [eq(proposals.organizationId, organizationId)];
        if (options.creatorScope !== null) conditions.push(eq(opportunities.creatorId, options.creatorScope));
        if (!options.includeArchived) conditions.push(ne(proposals.status, "ARCHIVED"));

        const rows = await tx
          .select({
            id: proposals.id,
            title: proposals.title,
            status: proposals.status,
            createdAt: proposals.createdAt,
            creatorName: creators.displayName,
            creatorUserId: creators.userId,
            brandName: brands.name,
            companyName: companies.name,
          })
          .from(proposals)
          .innerJoin(opportunities, and(eq(opportunities.id, proposals.opportunityId), eq(opportunities.organizationId, organizationId)))
          .innerJoin(creators, and(eq(creators.id, opportunities.creatorId), eq(creators.organizationId, organizationId)))
          .leftJoin(brands, and(eq(brands.id, opportunities.brandId), eq(brands.organizationId, organizationId)))
          .leftJoin(companies, and(eq(companies.id, opportunities.companyId), eq(companies.organizationId, organizationId)))
          .where(and(...conditions))
          .orderBy(desc(proposals.createdAt), desc(proposals.id))
          .limit(QUEUE_LIMIT + 1);

        const truncated = rows.length > QUEUE_LIMIT;
        const loaded = rows.slice(0, QUEUE_LIMIT);
        if (loaded.length === 0) return { items: [], closedCount: 0, truncated: false };
        const ids = loaded.map((row) => row.id);

        const versions = await tx
          .selectDistinctOn([proposalVersions.proposalId], {
            proposalId: proposalVersions.proposalId,
            versionNumber: proposalVersions.versionNumber,
            createdAt: proposalVersions.createdAt,
          })
          .from(proposalVersions)
          .where(and(eq(proposalVersions.organizationId, organizationId), inArray(proposalVersions.proposalId, ids)))
          .orderBy(proposalVersions.proposalId, desc(proposalVersions.versionNumber));

        const publications = await tx
          .selectDistinctOn([proposalPublications.proposalId], {
            proposalId: proposalPublications.proposalId,
            versionNumber: proposalPublications.versionNumber,
            publishedAt: proposalPublications.publishedAt,
            action: proposalResponses.action,
            respondentName: proposalResponses.respondentName,
            message: proposalResponses.message,
            respondedAt: proposalResponses.respondedAt,
          })
          .from(proposalPublications)
          .leftJoin(
            proposalResponses,
            and(eq(proposalResponses.publicationId, proposalPublications.id), eq(proposalResponses.organizationId, organizationId)),
          )
          .where(and(eq(proposalPublications.organizationId, organizationId), inArray(proposalPublications.proposalId, ids)))
          .orderBy(proposalPublications.proposalId, desc(proposalPublications.publicationNumber));

        const approvals = await tx
          .selectDistinctOn([proposalApprovals.proposalId], {
            proposalId: proposalApprovals.proposalId,
            versionNumber: proposalApprovals.versionNumber,
            decision: proposalApprovals.decision,
            message: proposalApprovals.message,
            requestedAt: proposalApprovals.requestedAt,
            decidedAt: proposalApprovals.decidedAt,
          })
          .from(proposalApprovals)
          .where(and(eq(proposalApprovals.organizationId, organizationId), inArray(proposalApprovals.proposalId, ids)))
          .orderBy(proposalApprovals.proposalId, desc(proposalApprovals.requestNumber));

        const totals = await tx
          .select({
            proposalId: proposalItems.proposalId,
            total: sql<string>`coalesce(sum(${proposalItems.quantity} * ${proposalItems.unitPrice}), 0)`,
          })
          .from(proposalItems)
          .where(and(eq(proposalItems.organizationId, organizationId), inArray(proposalItems.proposalId, ids)))
          .groupBy(proposalItems.proposalId);

        const creatorUserIds = [...new Set(loaded.map((row) => row.creatorUserId))];
        const members = await tx
          .select({ userId: organizationMembers.userId })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.role, "CREATOR"),
              inArray(organizationMembers.userId, creatorUserIds),
            ),
          );

        const versionBy = new Map(versions.map((v) => [v.proposalId, v]));
        const publicationBy = new Map(publications.map((p) => [p.proposalId, p]));
        const approvalBy = new Map(approvals.map((a) => [a.proposalId, a]));
        const totalBy = new Map(totals.map((t) => [t.proposalId, Number(t.total)]));
        const withAccess = new Set(members.map((m) => m.userId));

        const items: QueueItem[] = loaded.map((row) => {
          const status = row.status as ProposalStatus;
          const version = versionBy.get(row.id);
          const publication = publicationBy.get(row.id) ?? null;
          const approval = approvalBy.get(row.id) ?? null;
          const latestVersionNumber = version?.versionNumber ?? 0;
          const flags = computeSendFlags({
            status,
            latestVersionNumber,
            latestPublicationVersionNumber: publication?.versionNumber ?? null,
          });
          const approvalState = deriveApprovalState({
            required: withAccess.has(row.creatorUserId),
            latestVersionNumber,
            latest: approval,
          });
          const situation = deriveQueueSituation({ status, ...flags, approvalState, hasPublication: publication !== null });

          const changes: QueueItem["changes"] =
            situation !== "changes_requested"
              ? null
              : approvalState === "changes_requested"
                ? { by: "creator", name: row.creatorName, excerpt: excerpt(approval?.message ?? null) ?? "" }
                : { by: "client", name: publication?.respondentName ?? "", excerpt: excerpt(publication?.message ?? null) ?? "" };

          const clientOutcome: QueueItem["clientOutcome"] =
            situation === "closed" && publication?.action && publication.action !== "REQUEST_CHANGES" && publication.respondentName && publication.respondedAt
              ? { action: publication.action, name: publication.respondentName, at: publication.respondedAt }
              : null;

          const activity = [row.createdAt, version?.createdAt, publication?.publishedAt, publication?.respondedAt, approval?.requestedAt, approval?.decidedAt]
            .filter((date): date is Date => date instanceof Date)
            .reduce((latest, date) => (date > latest ? date : latest));

          return {
            id: row.id,
            title: row.title,
            situation,
            creatorName: row.creatorName,
            counterpartName: row.brandName ?? row.companyName ?? null,
            totalCents: totalBy.get(row.id) ?? 0,
            lastActivityAt: activity,
            latestVersionNumber,
            latestPublication: publication ? { versionNumber: publication.versionNumber, publishedAt: publication.publishedAt } : null,
            changes,
            approvedByCreator: approvalState === "approved",
            approvalStale: approvalState === "stale",
            clientOutcome,
          };
        });

        items.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
        return { items, closedCount: items.filter((item) => item.situation === "closed").length, truncated };
      },
      { isolationLevel: "repeatable read" },
    );
  },
};
```
If `selectDistinctOn` is unavailable on the tx type, use `tx.selectDistinctOn` via the same builder the db exposes, or fall back to a `row_number() over (partition by …)` subquery — keep the organization predicates either way. If `companies`/`brands` have no `organizationId` column, check the schema and keep whatever tenant column they have.

- [ ] **Step 3:** Run tests → PASS; `tsc --noEmit` clean.
- [ ] **Step 4: Commit** `feat(proposals): proposal queue service`.

---

### Task 3: `GET /api/proposals/queue`

**Files:** Create `src/app/api/proposals/queue/route.ts`, `src/app/api/proposals/queue/route.test.ts`.

**Interfaces — Consumes:** `ProposalQueueService.list`. **Produces:** JSON `{ items: QueueItem[] (dates as ISO strings), closedCount, truncated }`.

- [ ] **Step 1: Failing tests** (pattern: `src/app/api/creators/[id]/access/route.test.ts` — `importRouteWithSession`, `ownerSession`, `creatorSession`):
  - no session → 401.
  - OWNER → 200 with the org's items (seed 2 proposals, assert both ids and `closedCount`, `truncated: false`).
  - CREATOR (`creatorSession(org, creator.userId, creator.id)`) → only own proposals (second creator's proposal absent).
  - CREATOR session with `creatorId: null` → 200 `{ items: [], closedCount: 0, truncated: false }`.
  - archived proposal absent by default; present with `?includeArchived=1`; `?includeArchived=true` behaves as default (absent).
  Run → FAIL.
- [ ] **Step 2: Implement**
```ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { creatorScope, isCreator } from "@/lib/auth/access";
import { ProposalQueueService } from "@/services/proposal-queue.service";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const scope = creatorScope(session);
  if (isCreator(session) && scope === null) {
    return NextResponse.json({ items: [], closedCount: 0, truncated: false }, { status: 200 });
  }

  const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "1";
  const result = await ProposalQueueService.list(db, session.organizationId, { creatorScope: scope, includeArchived });
  return NextResponse.json(result, { status: 200 });
}
```
- [ ] **Step 3:** Run the route tests plus `src/app/api/write-guard.test.ts src/app/api/id-guard.test.ts` → PASS; `tsc --noEmit` clean.
- [ ] **Step 4: Commit** `feat(api): GET /api/proposals/queue`.

---

### Task 4: Page `/proposals`

**Files:** Create `src/lib/proposals/queue-labels.ts` (+ `queue-labels.test.ts`), `src/hooks/use-proposal-queue.ts`, `src/app/(app)/proposals/page.tsx` (+ `page.test.tsx`).

**Interfaces — Consumes:** Task 3 JSON. `useIsCreator` from `@/components/shell/session-role-context`; `formatBRL(cents)` from `@/lib/presentation/format`; `EmptyState` from `@/components/ui/empty-state` (props `icon`, `title`, `description`, `action`); `apiFetch` from `@/lib/api-client`.

- [ ] **Step 1: DTOs + hook** `src/hooks/use-proposal-queue.ts`:
```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export type QueueSituationDto = "changes_requested" | "ready_to_send" | "awaiting_creator" | "draft" | "awaiting_client" | "closed" | "archived";

export interface QueueItemDto {
  id: string;
  title: string;
  situation: QueueSituationDto;
  creatorName: string;
  counterpartName: string | null;
  totalCents: number;
  lastActivityAt: string;
  latestVersionNumber: number;
  latestPublication: { versionNumber: number; publishedAt: string } | null;
  changes: { by: "client" | "creator"; name: string; excerpt: string } | null;
  approvedByCreator: boolean;
  approvalStale: boolean;
  clientOutcome: { action: "ACCEPT" | "REJECT"; name: string; at: string } | null;
}

export interface ProposalQueueDto {
  items: QueueItemDto[];
  closedCount: number;
  truncated: boolean;
}

export function useProposalQueue(includeArchived: boolean): UseQueryResult<ProposalQueueDto> {
  return useQuery({
    queryKey: ["proposals", "queue", includeArchived],
    queryFn: () => apiFetch<ProposalQueueDto>(`/api/proposals/queue${includeArchived ? "?includeArchived=1" : ""}`),
  });
}
```
(`usePublishProposal` already invalidates `["proposals"]`, which covers this key.)

- [ ] **Step 2: Failing label tests** `src/lib/proposals/queue-labels.test.ts`:
  - `groupsFor("agency")` → labels in order `["Ajustes pedidos","Pronta para enviar","Aguardando creator","Rascunho","Aguardando cliente","Fechadas","Arquivadas"]` with situations `[["changes_requested"],["ready_to_send"],["awaiting_creator"],["draft"],["awaiting_client"],["closed"],["archived"]]`.
  - `groupsFor("creator")` → `["Aguardando sua aprovação","Em ajustes","Com a agência","Aguardando cliente","Fechadas","Arquivadas"]` with `[["awaiting_creator"],["changes_requested"],["ready_to_send","draft"],["awaiting_client"],["closed"],["archived"]]`.
  - `detailLine(item, viewer)` for every row of spec §5's table, e.g.:
    - client changes → `"Maria pediu: Trocar a capa"` (both viewers);
    - creator changes → agency `"Thais pediu: Ajustar preço"`, creator `"Você pediu: Ajustar preço"`;
    - ready_to_send approved → `"Aprovada por Thais"`; not approved → `"Alterações não enviadas · versão 3"`;
    - awaiting_creator v2 → agency `"Versão 2 aguardando aprovação"`, creator `"Versão 2 aguardando sua aprovação"`;
    - draft stale → `"A proposta mudou depois do pedido de aprovação"`; draft with publication → `"Alterações não enviadas · versão 3"`; draft never sent → `"Ainda não enviada"`;
    - awaiting_client → `"Versão 2 enviada em 28/09/2026"` (publishedAt `2026-09-28T15:00:00Z`);
    - closed ACCEPT → `"Aceita por Maria em 29/09/2026"`; REJECT → `"Recusada por Maria em 29/09/2026"`;
    - archived → `"Arquivada"`.
  Run → FAIL.
- [ ] **Step 3: Implement** `src/lib/proposals/queue-labels.ts`:
```ts
import type { QueueItemDto, QueueSituationDto } from "@/hooks/use-proposal-queue";

export type QueueViewer = "agency" | "creator";

export interface QueueGroup {
  key: string;
  label: string;
  situations: QueueSituationDto[];
}

const AGENCY_GROUPS: QueueGroup[] = [
  { key: "changes", label: "Ajustes pedidos", situations: ["changes_requested"] },
  { key: "ready", label: "Pronta para enviar", situations: ["ready_to_send"] },
  { key: "awaiting-creator", label: "Aguardando creator", situations: ["awaiting_creator"] },
  { key: "draft", label: "Rascunho", situations: ["draft"] },
  { key: "awaiting-client", label: "Aguardando cliente", situations: ["awaiting_client"] },
  { key: "closed", label: "Fechadas", situations: ["closed"] },
  { key: "archived", label: "Arquivadas", situations: ["archived"] },
];

const CREATOR_GROUPS: QueueGroup[] = [
  { key: "awaiting-creator", label: "Aguardando sua aprovação", situations: ["awaiting_creator"] },
  { key: "changes", label: "Em ajustes", situations: ["changes_requested"] },
  { key: "agency", label: "Com a agência", situations: ["ready_to_send", "draft"] },
  { key: "awaiting-client", label: "Aguardando cliente", situations: ["awaiting_client"] },
  { key: "closed", label: "Fechadas", situations: ["closed"] },
  { key: "archived", label: "Arquivadas", situations: ["archived"] },
];

export function groupsFor(viewer: QueueViewer): QueueGroup[] {
  return viewer === "creator" ? CREATOR_GROUPS : AGENCY_GROUPS;
}

export const shortDate = (iso: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

export function detailLine(item: QueueItemDto, viewer: QueueViewer): string {
  switch (item.situation) {
    case "changes_requested": {
      const changes = item.changes;
      if (!changes) return "Ajustes pedidos";
      const who = changes.by === "creator" && viewer === "creator" ? "Você" : changes.name;
      return `${who} pediu: ${changes.excerpt}`;
    }
    case "ready_to_send":
      return item.approvedByCreator ? `Aprovada por ${item.creatorName}` : `Alterações não enviadas · versão ${item.latestVersionNumber}`;
    case "awaiting_creator":
      return viewer === "creator"
        ? `Versão ${item.latestVersionNumber} aguardando sua aprovação`
        : `Versão ${item.latestVersionNumber} aguardando aprovação`;
    case "draft":
      if (item.approvalStale) return "A proposta mudou depois do pedido de aprovação";
      return item.latestPublication ? `Alterações não enviadas · versão ${item.latestVersionNumber}` : "Ainda não enviada";
    case "awaiting_client":
      return item.latestPublication
        ? `Versão ${item.latestPublication.versionNumber} enviada em ${shortDate(item.latestPublication.publishedAt)}`
        : "Aguardando cliente";
    case "closed":
      if (!item.clientOutcome) return "Fechada";
      return `${item.clientOutcome.action === "ACCEPT" ? "Aceita" : "Recusada"} por ${item.clientOutcome.name} em ${shortDate(item.clientOutcome.at)}`;
    case "archived":
      return "Arquivada";
  }
}
```
Run → PASS.

- [ ] **Step 4: Failing page tests** `src/app/(app)/proposals/page.test.tsx` (mock `@/hooks/use-proposal-queue` and `@/components/shell/session-role-context`; wrap in the same providers other page tests use — see `src/app/(app)/creators/page.test.tsx`):
  - agency with items in 3 situations → group headings in agency order with counts (e.g. `"Ajustes pedidos (1)"`), empty groups absent, each row links to `/proposals/{id}`, shows title, creator name, counterpart, `formatBRL(totalCents)`, detail line, last activity date.
  - creator → headings `"Aguardando sua aprovação (1)"` first, `"Com a agência (2)"` merging ready_to_send + draft, and **no creator name** in rows.
  - "Mostrar arquivadas" calls the hook with `true` (assert the hook mock's last argument) and the button then reads "Ocultar arquivadas"; an archived item renders under "Arquivadas".
  - `truncated: true` → "Mostrando as 200 propostas mais recentes."
  - no items → "Nenhuma proposta ainda." + "Propostas são criadas a partir de uma oportunidade no Pipeline." + link "Ir para o Pipeline" to `/pipeline`.
  - loading → "Carregando..."; error → "Não foi possível carregar as propostas." and "Tentar novamente" calls `refetch`.
  Run → FAIL.
- [ ] **Step 5: Implement** `src/app/(app)/proposals/page.tsx`:
```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useIsCreator } from "@/components/shell/session-role-context";
import { useProposalQueue } from "@/hooks/use-proposal-queue";
import { detailLine, groupsFor, shortDate } from "@/lib/proposals/queue-labels";
import { formatBRL } from "@/lib/presentation/format";

export default function ProposalsPage() {
  const isCreator = useIsCreator();
  const viewer = isCreator ? "creator" : "agency";
  const [showArchived, setShowArchived] = React.useState(false);
  const { data, isLoading, isError, refetch } = useProposalQueue(showArchived);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Propostas</h1>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowArchived((value) => !value)}>
          {showArchived ? "Ocultar arquivadas" : "Mostrar arquivadas"}
        </Button>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : null}

      {isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">Não foi possível carregar as propostas.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhuma proposta ainda."
          description="Propostas são criadas a partir de uma oportunidade no Pipeline."
          action={
            <Button asChild size="sm">
              <Link href="/pipeline">Ir para o Pipeline</Link>
            </Button>
          }
        />
      ) : null}

      {data && data.truncated ? <p className="text-xs text-muted-foreground">Mostrando as 200 propostas mais recentes.</p> : null}

      {data
        ? groupsFor(viewer).map((group) => {
            const items = data.items.filter((item) => group.situations.includes(item.situation));
            if (items.length === 0) return null;
            return (
              <section key={group.key} aria-label={group.label} className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">
                  {group.label} ({items.length})
                </h2>
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Link href={`/proposals/${item.id}`} className="flex flex-col gap-1 p-3 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium">{item.title}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {[isCreator ? null : item.creatorName, item.counterpartName].filter(Boolean).join(" · ")}
                          </span>
                          <span className="text-xs text-muted-foreground">{detailLine(item, viewer)}</span>
                        </div>
                        <div className="flex shrink-0 flex-col items-start gap-0.5 sm:items-end">
                          <span className="text-sm font-medium">{formatBRL(item.totalCents)}</span>
                          <span className="text-xs text-muted-foreground">{shortDate(item.lastActivityAt)}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        : null}
    </div>
  );
}
```
Check `EmptyState`'s `action` prop type and `Button asChild` support in `src/components/ui/`; adapt if different (keep the copy). The creator/counterpart line renders nothing when both are empty.
- [ ] **Step 6:** Run label + page tests → PASS; run the full suite once and the build (`OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build`) → green; `tsc --noEmit` clean.
- [ ] **Step 7: Commit** `feat(proposals): /proposals queue page`.

---

## Real verification (controller + user, after Task 4)

Local dev DB (`publyflow`) has one proposal ("Proposta Marca Teste — Reels", sent v2 without approval → `awaiting_client`) and creator "Creator Teste" (access revoked). Controller starts the worktree dev server.
1. OWNER opens `/proposals` from the sidebar → "Aguardando cliente (1)" with "Versão 2 enviada em …", creator name, R$ 7.000,00.
2. OWNER edits the proposal → it moves to "Pronta para enviar" (creator without access, previously sent).
3. OWNER creates a second proposal from the Pipeline → appears under "Rascunho" · "Ainda não enviada".
4. OWNER archives it → disappears; "Mostrar arquivadas" shows it under "Arquivadas".
5. Re-invite the creator; OWNER requests approval on the first proposal → it moves to "Aguardando creator". User (incognito, devandanalytics) opens `/proposals` → "Aguardando sua aprovação (1)" first, no creator name on rows.
6. Revoke access at the end (leave the dev DB as found).

## Deploy

No migration, no env vars. User pushes `main`.
