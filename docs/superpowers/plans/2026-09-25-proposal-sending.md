# Proposal Sending & Client Response (Spec 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the creator publish a frozen version of a proposal to a public link (`/p/<token>`), let the client accept, request changes or reject it without logging in, and reflect the result in the proposal's commercial status, the pipeline and the builder.

**Architecture:** Three immutable layers on top of the existing versions: `proposal_versions` (document) → `proposal_publications` (what was actually sent, with a frozen context) → `proposal_responses` (at most one per publication). `proposals.status` holds the commercial state; `hasUnsentChanges` (latest version ≠ latest published version) is computed server-side in a single `send-state` read. Sending and responding run in transactions that lock the proposal row, never create versions, and move the opportunity only while it is open. The public page reuses `buildPresentation` + `PresentationRenderer` from Presentation Themes V1.

**Tech Stack:** Next.js 16 App Router (route groups, route handlers, `next.config.ts` headers, `React.cache`), React 19, TanStack Query, Drizzle + Postgres (row locks, triggers, RLS), zod 4, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-25-proposal-sending-design.md` — the source of truth. Do not reinterpret its product decisions.

## Global Constraints

- **Read the Next.js 16 docs before Next-specific code** (`AGENTS.md`), in `node_modules/next/dist/docs/`: route groups, route handlers, `next.config` `headers`, `generateMetadata`, `notFound`.
- Invariants (spec §2): publications and responses are immutable; at most one response per publication; `status ∈ {SENT, CHANGES_REQUESTED, APPROVED, REJECTED}` ⇒ a publication exists; `status = SENT` ⇒ latest publication has no response; `status ∈ {CHANGES_REQUESTED, APPROVED, REJECTED}` ⇒ latest publication has the matching response (`REQUEST_CHANGES`, `ACCEPT`, `REJECT`); at send time `publication.versionNumber = latest version`; sending and responding never create versions.
- `hasUnsentChanges` is true exactly when `latestVersion.versionNumber ≠ latestPublication.versionNumber`, or when there is no publication. `canSend = status ≠ ARCHIVED && (status = DRAFT || hasUnsentChanges)`.
- Pipeline mapping: send → `PROPOSTA_ENVIADA`; `REQUEST_CHANGES` → `NEGOCIACAO`; `ACCEPT` → `FECHADO`; `REJECT` → `PERDIDO`. Never move an opportunity whose stage is `FECHADO` or `PERDIDO`.
- The public link is available only when `status ∈ {SENT, CHANGES_REQUESTED, APPROVED, REJECTED}`. Public token: 32 random bytes, base64url, 43 chars (`/^[A-Za-z0-9_-]{43}$/`).
- Public reads/writes resolve everything through the chain **token → proposal → publication**; never look up a publication globally. A `publicationId` that is not the proposal's latest publication (old, nonexistent, or another proposal's) → `SUPERSEDED`.
- Creator routes take organization and user only from the session (Auth v1); the public route takes no session.
- No caching of anything public: page `force-dynamic` + `Cache-Control: private, no-store` (via `next.config.ts`); public API responses `Cache-Control: no-store`.
- `buildPresentation()` stays pure; the loader normalizes `issuedAt` to a `Date` before calling it. Everything under `src/components/presentation/` except `fonts.ts` stays server-free; responsive rules inside the rendered document use container queries (`@xl:`) only.
- Portuguese UI copy, exactly as written in this plan.
- **Database rule:** implementers never run `drizzle-kit migrate`, `psql`, or anything writing to a database outside the Vitest suite. The controller applies migrations.
- Use `/opt/homebrew/bin/pnpm`. Full suite: `/opt/homebrew/bin/pnpm vitest run` (add `--testTimeout=60000 --hookTimeout=60000` if DB tests time out under host load). Build: `OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build`.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema/proposals.ts` | + status values, `publicToken`, `proposalResponseActionEnum`, `proposalPublications`, `proposalResponses` |
| `src/db/migrations/0017_add_proposal_publications.sql` | generated DDL + hand-written RLS and immutability triggers |
| `src/lib/proposal-themes.ts` | status list, labels, badge variants, public statuses |
| `src/lib/proposal-sharing.ts` | token format, `publicPathFor`, response-action/status/stage maps (pure) |
| `src/lib/presentation/snapshot-schema.ts` | zod: stored snapshot + publication context |
| `src/lib/presentation/present-response.ts` | response → renderer-friendly `PresentationResponse` |
| `src/lib/presentation/format.ts` | + `formatDateTime` |
| `src/components/presentation/*` | renderer `response` prop, theme result slots, public view + dialog |
| `src/repositories/proposal-publications.repository.ts`, `proposal-responses.repository.ts` | data access |
| `src/services/proposal-pipeline.ts` | move opportunity only while open |
| `src/services/proposal-sending.service.ts` | publish, send-state, history |
| `src/services/proposal-response.service.ts` | client response |
| `src/services/public-proposal.service.ts` | `loadByToken` |
| `src/app/(public)/…`, `src/app/api/public/…` | public page + API |
| `src/app/api/proposals/[id]/publications`, `…/send-state` | creator API |
| `src/hooks/use-proposal-sending.ts` | creator hooks |
| `src/components/proposals/proposal-send-panel.tsx`, `proposal-send-history.tsx`, `proposal-status-badge.tsx` | builder UI |
| `src/test/helpers/proposal-fixtures.ts`, `proposal-invariants.ts` | shared test seeding + invariant checks |

---

### Task 1: Schema, migration 0017, status vocabulary

**Files:**
- Modify: `src/db/schema/proposals.ts`, `src/lib/proposal-themes.ts`, `src/lib/proposal-themes.test.ts`, `src/test/helpers/db.ts`
- Create: `src/db/migrations/0017_add_proposal_publications.sql` (+ generated `meta/0017_snapshot.json`, journal entry)
- Test: `src/db/schema/proposal-publications.test.ts`, `src/db/rls-proposal-publications.test.ts`

**Interfaces:**
- Produces (Drizzle): `proposalStatusEnum` values `["DRAFT", "ARCHIVED", "SENT", "CHANGES_REQUESTED", "APPROVED", "REJECTED"]` (new values appended — Postgres appends); `proposals.publicToken` (`text("public_token").unique()`, nullable); `proposalResponseActionEnum` `["ACCEPT", "REQUEST_CHANGES", "REJECT"]`; tables `proposalPublications` (`id, organizationId, proposalId, publicationNumber, versionId, versionNumber, context, publishedBy, publishedAt`) and `proposalResponses` (`id, organizationId, publicationId (unique), action, respondentName, respondentEmail, message, respondedAt`).
- Produces (`src/lib/proposal-themes.ts`): `type ProposalStatus = "DRAFT" | "ARCHIVED" | "SENT" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED"`; `PROPOSAL_STATUS_LABELS` (Rascunho, Arquivada, Enviada, Ajustes pedidos, Aceita, Recusada); `PROPOSAL_STATUS_BADGE_VARIANT: Record<ProposalStatus, "default" | "info" | "warning" | "success" | "error">`; `PUBLIC_PROPOSAL_STATUSES: ProposalStatus[]`.

- [ ] **Step 1: Write the failing tests**

Update `src/lib/proposal-themes.test.ts` — replace the status test with:

```typescript
  it("labels every proposal status in Portuguese with a badge variant", () => {
    expect(PROPOSAL_STATUS_LABELS).toEqual({
      DRAFT: "Rascunho",
      ARCHIVED: "Arquivada",
      SENT: "Enviada",
      CHANGES_REQUESTED: "Ajustes pedidos",
      APPROVED: "Aceita",
      REJECTED: "Recusada",
    });
    expect(PROPOSAL_STATUS_BADGE_VARIANT).toEqual({
      DRAFT: "default",
      ARCHIVED: "default",
      SENT: "info",
      CHANGES_REQUESTED: "warning",
      APPROVED: "success",
      REJECTED: "error",
    });
    expect(PUBLIC_PROPOSAL_STATUSES).toEqual(["SENT", "CHANGES_REQUESTED", "APPROVED", "REJECTED"]);
  });
```

(add `PROPOSAL_STATUS_BADGE_VARIANT, PUBLIC_PROPOSAL_STATUSES` to its import).

```typescript
// src/db/schema/proposal-publications.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { leads, opportunities } from "./commercial-flow";
import { proposals, proposalVersions, proposalPublications, proposalResponses } from "./proposals";

describe("proposal_publications / proposal_responses schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: NodePgDatabase<typeof schema>) {
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db.insert(users).values({ email: "thais@publyflow.test", fullName: "Thais" }).returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [contact] = await db.insert(contacts).values({ organizationId: org.id, fullName: "Maria" }).returning();
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
      .values({ organizationId: org.id, opportunityId: opportunity.id, title: "P", theme: "PREMIUM" })
      .returning();
    const [version] = await db
      .insert(proposalVersions)
      .values({ organizationId: org.id, proposalId: proposal.id, versionNumber: 1, snapshotJson: {}, createdBy: user.id })
      .returning();
    const [publication] = await db
      .insert(proposalPublications)
      .values({
        organizationId: org.id,
        proposalId: proposal.id,
        publicationNumber: 1,
        versionId: version.id,
        versionNumber: 1,
        context: { creator: { displayName: "Thais", instagramHandle: null }, clientName: null, issuedAt: "2026-09-25T15:00:00.000Z" },
        publishedBy: user.id,
        publishedAt: new Date("2026-09-25T15:00:00Z"),
      })
      .returning();
    return { org, user, proposal, publication };
  }

  it("stores new statuses and a unique public token", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal } = await setup(db);

    await db.update(proposals).set({ status: "SENT", publicToken: "a".repeat(43) }).where(eq(proposals.id, proposal.id));
    const [reloaded] = await db.select().from(proposals).where(eq(proposals.id, proposal.id));
    expect(reloaded.status).toBe("SENT");

    const [other] = await db
      .insert(proposals)
      .values({ organizationId: org.id, opportunityId: proposal.opportunityId, title: "Q", theme: "MINIMAL" })
      .returning();
    await expect(
      db.update(proposals).set({ publicToken: "a".repeat(43) }).where(eq(proposals.id, other.id)),
    ).rejects.toThrow();
  });

  it("accepts at most one response per publication", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, publication } = await setup(db);

    const values = {
      organizationId: org.id,
      publicationId: publication.id,
      action: "ACCEPT" as const,
      respondentName: "Maria",
      respondentEmail: "maria@x.test",
      message: null,
    };
    await db.insert(proposalResponses).values(values);
    await expect(db.insert(proposalResponses).values({ ...values, action: "REJECT" })).rejects.toThrow();
  });

  it("rejects any UPDATE of a publication or a response (immutability trigger)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, publication } = await setup(db);
    const [response] = await db
      .insert(proposalResponses)
      .values({
        organizationId: org.id,
        publicationId: publication.id,
        action: "REQUEST_CHANGES",
        respondentName: "Maria",
        respondentEmail: "maria@x.test",
        message: "Trocar stories",
      })
      .returning();

    await expect(
      db.update(proposalPublications).set({ versionNumber: 2 }).where(eq(proposalPublications.id, publication.id)),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.update(proposalResponses).set({ message: "outra" }).where(eq(proposalResponses.id, response.id)),
    ).rejects.toThrow(/immutable/);
    await expect(db.execute(sql`select 1`)).resolves.toBeDefined();
  });
});
```

```typescript
// src/db/rls-proposal-publications.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { organizations, users } from "./schema/organizations";
import { creators } from "./schema/creators";
import { contacts } from "./schema/companies-brands-contacts";
import { leads, opportunities } from "./schema/commercial-flow";
import { proposals, proposalVersions, proposalPublications, proposalResponses } from "./schema/proposals";

describe("RLS on proposal_publications and proposal_responses", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns rows of the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    async function seed(orgName: string) {
      const [org] = await db.insert(organizations).values({ name: orgName }).returning();
      const [user] = await db.insert(users).values({ email: `${orgName}@publyflow.test`, fullName: orgName }).returning();
      const [creator] = await db
        .insert(creators)
        .values({ organizationId: org.id, userId: user.id, displayName: orgName })
        .returning();
      const [contact] = await db.insert(contacts).values({ organizationId: org.id, fullName: "Contact" }).returning();
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
        .values({ organizationId: org.id, opportunityId: opportunity.id, title: orgName, theme: "PREMIUM" })
        .returning();
      const [version] = await db
        .insert(proposalVersions)
        .values({ organizationId: org.id, proposalId: proposal.id, versionNumber: 1, snapshotJson: {}, createdBy: user.id })
        .returning();
      const [publication] = await db
        .insert(proposalPublications)
        .values({
          organizationId: org.id,
          proposalId: proposal.id,
          publicationNumber: 1,
          versionId: version.id,
          versionNumber: 1,
          context: {},
          publishedBy: user.id,
          publishedAt: new Date(),
        })
        .returning();
      await db.insert(proposalResponses).values({
        organizationId: org.id,
        publicationId: publication.id,
        action: "ACCEPT",
        respondentName: "X",
        respondentEmail: "x@x.test",
        message: null,
      });
      return { org, publication };
    }

    const a = await seed("Org A");
    await seed("Org B");

    const appDb = getAppUserDb();
    const visible = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${a.org.id}, true)`);
      return {
        publications: await tx.select().from(proposalPublications),
        responses: await tx.select().from(proposalResponses),
      };
    });

    expect(visible.publications.map((row) => row.id)).toEqual([a.publication.id]);
    expect(visible.responses.map((row) => row.publicationId)).toEqual([a.publication.id]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/proposal-themes.test.ts src/db/schema/proposal-publications.test.ts src/db/rls-proposal-publications.test.ts`
Expected: FAIL (missing exports/tables).

- [ ] **Step 3: Status vocabulary** — in `src/lib/proposal-themes.ts` replace the status part with:

```typescript
export type ProposalStatus = "DRAFT" | "ARCHIVED" | "SENT" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho",
  ARCHIVED: "Arquivada",
  SENT: "Enviada",
  CHANGES_REQUESTED: "Ajustes pedidos",
  APPROVED: "Aceita",
  REJECTED: "Recusada",
};

export const PROPOSAL_STATUS_BADGE_VARIANT: Record<ProposalStatus, "default" | "info" | "warning" | "success" | "error"> = {
  DRAFT: "default",
  ARCHIVED: "default",
  SENT: "info",
  CHANGES_REQUESTED: "warning",
  APPROVED: "success",
  REJECTED: "error",
};

/** Statuses in which the public link shows the latest publication. */
export const PUBLIC_PROPOSAL_STATUSES: ProposalStatus[] = ["SENT", "CHANGES_REQUESTED", "APPROVED", "REJECTED"];
```

- [ ] **Step 4: Drizzle schema** — in `src/db/schema/proposals.ts` (add `index` to the `drizzle-orm/pg-core` import):

```typescript
export const proposalStatusEnum = pgEnum("proposal_status", [
  "DRAFT",
  "ARCHIVED",
  "SENT",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
]);
```

In `proposals` add `publicToken: text("public_token").unique(),` after `status`. After `proposalVersions`, add:

```typescript
export const proposalResponseActionEnum = pgEnum("proposal_response_action", ["ACCEPT", "REQUEST_CHANGES", "REJECT"]);

export const proposalPublications = pgTable(
  "proposal_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    /** 1, 2, 3… per proposal; defines "latest" (never rely on timestamps). */
    publicationNumber: integer("publication_number").notNull(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => proposalVersions.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    /** Frozen at send time: { creator: { displayName, instagramHandle }, clientName, issuedAt (ISO) }. */
    context: jsonb("context").notNull(),
    publishedBy: uuid("published_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("proposal_publications_proposal_number_unique").on(table.proposalId, table.publicationNumber),
    index("proposal_publications_proposal_idx").on(table.proposalId),
  ],
);

export const proposalResponses = pgTable("proposal_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  publicationId: uuid("publication_id")
    .notNull()
    .unique()
    .references(() => proposalPublications.id, { onDelete: "cascade" }),
  action: proposalResponseActionEnum("action").notNull(),
  respondentName: text("respondent_name").notNull(),
  respondentEmail: text("respondent_email").notNull(),
  message: text("message"),
  respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
});
```

In `src/test/helpers/db.ts` add `"proposal_responses", "proposal_publications",` at the top of `DOMAIN_TABLES`.

- [ ] **Step 5: Generate the migration and append RLS + triggers**

```bash
/opt/homebrew/bin/pnpm drizzle-kit generate --name add_proposal_publications </dev/null
```

It must create `src/db/migrations/0017_add_proposal_publications.sql` without prompting (new tables, new enum values and a new column never prompt). If it prompts or fails, stop and report BLOCKED with the output. Check the SQL adds the four enum values, `public_token` + its unique constraint, both tables, FKs, the unique constraints and the index — nothing else.

Append to the end of `0017_add_proposal_publications.sql` (one statement block, same style as 0014):

```sql

alter table proposal_publications enable row level security;

create policy org_isolation_proposal_publications on proposal_publications
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

alter table proposal_responses enable row level security;

create policy org_isolation_proposal_responses on proposal_responses
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Publications and responses are an audit trail: what the client received
-- and how they answered. They are never updated (deletion only by cascade).
create function prevent_update_immutable_row() returns trigger language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name;
end;
$$;

create trigger proposal_publications_immutable before update on proposal_publications
  for each row execute function prevent_update_immutable_row();

create trigger proposal_responses_immutable before update on proposal_responses
  for each row execute function prevent_update_immutable_row();
```

- [ ] **Step 6: STOP — hand off the migration**

Report NEEDS_CONTEXT with "migration 0017 generated with RLS and triggers, awaiting controller to apply". Do not commit. The controller applies it to the test and dev databases and resumes you.

- [ ] **Step 7: Run the tests to see them pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/proposal-themes.test.ts src/db/schema/proposal-publications.test.ts src/db/rls-proposal-publications.test.ts`
Expected: PASS.

- [ ] **Step 8: Full suite, build, commit**

`ProposalStatus` widened: fix any compile error only by widening types (no behavior changes). Then:

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/db src/lib/proposal-themes.ts src/lib/proposal-themes.test.ts src/test/helpers/db.ts
git commit -m "feat: add proposal publications and responses schema"
```

---

### Task 2: Presentation contracts — stored-data validation and the response in the renderer

**Files:**
- Create: `src/lib/presentation/snapshot-schema.ts`, `src/lib/presentation/present-response.ts`, `src/lib/proposal-sharing.ts`
- Modify: `src/lib/presentation/types.ts`, `src/lib/presentation/format.ts`, `src/components/presentation/theme-types.ts`, `src/components/presentation/themes/*.ts` (6 files), `src/components/presentation/sections.tsx`, `src/components/presentation/presentation-renderer.tsx`
- Test: `src/lib/presentation/snapshot-schema.test.ts`, `src/lib/presentation/present-response.test.ts`, `src/lib/proposal-sharing.test.ts`, `src/components/presentation/presentation-renderer.test.tsx` (extend)

**Interfaces:**
- Consumes: `PresentationSnapshotInput`, `formatIssuedAt` (V1); `ProposalStatus` (Task 1).
- Produces (`snapshot-schema.ts`): `parsePresentationSnapshot(value: unknown): PresentationSnapshotInput` (throws `ZodError`); `interface PublicationContext { creator: { displayName: string; instagramHandle: string | null }; clientName: string | null; issuedAt: Date }`; `interface PublicationContextJson` (same, `issuedAt: string`); `parsePublicationContext(value: unknown): PublicationContext`; `toPublicationContextJson(parties: { creator: PublicationContext["creator"]; clientName: string | null }, issuedAt: Date): PublicationContextJson`.
- Produces (`types.ts`): `type PresentationResponseAction = "ACCEPT" | "REQUEST_CHANGES" | "REJECT"`; `interface PresentationResponse { action: PresentationResponseAction; respondentName: string; respondedAtLabel: string; message: string | null }`.
- Produces: `presentResponse(response: { action; respondentName: string; respondedAt: Date; message: string | null }): PresentationResponse`; `formatDateTime(date: Date): string` (`"25/09/2026, 14:32"`, São Paulo).
- Produces (`proposal-sharing.ts`, pure): `PUBLIC_TOKEN_PATTERN`, `isPublicTokenFormat(token: string): boolean`, `publicPathFor(token: string): string` (`/p/<token>`), `RESPONSE_STATUS: Record<PresentationResponseAction, ProposalStatus>`, `RESPONSE_STAGE: Record<PresentationResponseAction, "NEGOCIACAO" | "FECHADO" | "PERDIDO">`, `SENT_STAGE = "PROPOSTA_ENVIADA"`, `CLOSED_STAGES: ReadonlySet<string>` (`FECHADO`, `PERDIDO`).
- Produces: `PresentationRenderer({ model, theme?, onAction?, className?, response? })` — with `response`, the actions area shows the themed result instead of buttons (`role="status"`).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/presentation/snapshot-schema.test.ts
import { describe, it, expect } from "vitest";
import { parsePresentationSnapshot, parsePublicationContext, toPublicationContextJson } from "./snapshot-schema";

const stored = {
  proposal: { title: "Campanha", theme: "EDITORIAL", status: "DRAFT" },
  items: [{ id: "i1", description: "Reel", quantity: 3, unitPrice: 250000, sortOrder: 0, createdAt: "2026-09-25T15:00:00.000Z" }],
  blocks: [{ id: "b1", blockType: "COVER", content: { headline: "Verão" }, sortOrder: 0 }],
};

describe("parsePresentationSnapshot", () => {
  it("keeps only what the presentation needs", () => {
    expect(parsePresentationSnapshot(stored)).toEqual({
      proposal: { title: "Campanha", theme: "EDITORIAL", status: "DRAFT" },
      items: [{ description: "Reel", quantity: 3, unitPrice: 250000, sortOrder: 0 }],
      blocks: [{ blockType: "COVER", content: { headline: "Verão" } }],
    });
  });

  it("accepts legacy snapshots that carry `template`", () => {
    const legacy = { ...stored, proposal: { title: "Antiga", template: "FASHION", status: "DRAFT" } };
    expect(parsePresentationSnapshot(legacy).proposal).toEqual({ title: "Antiga", template: "FASHION", status: "DRAFT" });
  });

  it("throws on corrupted data", () => {
    expect(() => parsePresentationSnapshot({ proposal: { title: 1 }, items: [], blocks: [] })).toThrow();
    expect(() => parsePresentationSnapshot(null)).toThrow();
  });
});

describe("publication context", () => {
  it("round-trips through JSON with issuedAt normalized to a Date", () => {
    const json = toPublicationContextJson(
      { creator: { displayName: "Thais", instagramHandle: "@thais" }, clientName: "Bella" },
      new Date("2026-09-25T15:00:00Z"),
    );
    expect(json).toEqual({
      creator: { displayName: "Thais", instagramHandle: "@thais" },
      clientName: "Bella",
      issuedAt: "2026-09-25T15:00:00.000Z",
    });
    const parsed = parsePublicationContext(JSON.parse(JSON.stringify(json)));
    expect(parsed.issuedAt).toBeInstanceOf(Date);
    expect(parsed.issuedAt.toISOString()).toBe("2026-09-25T15:00:00.000Z");
    expect(parsed.clientName).toBe("Bella");
  });

  it("throws on corrupted context", () => {
    expect(() => parsePublicationContext({ creator: {}, clientName: null, issuedAt: "ontem" })).toThrow();
  });
});
```

```typescript
// src/lib/presentation/present-response.test.ts
import { describe, it, expect } from "vitest";
import { presentResponse } from "./present-response";
import { formatDateTime } from "./format";

describe("presentResponse / formatDateTime", () => {
  it("formats the response date and keeps the message", () => {
    expect(
      presentResponse({ action: "REQUEST_CHANGES", respondentName: "Maria", respondedAt: new Date("2026-09-25T17:32:00Z"), message: "Trocar stories" }),
    ).toEqual({ action: "REQUEST_CHANGES", respondentName: "Maria", respondedAtLabel: "25 de setembro de 2026", message: "Trocar stories" });
  });

  it("formats date and time in São Paulo", () => {
    expect(formatDateTime(new Date("2026-09-25T17:32:00Z"))).toBe("25/09/2026, 14:32");
  });
});
```

```typescript
// src/lib/proposal-sharing.test.ts
import { describe, it, expect } from "vitest";
import { CLOSED_STAGES, RESPONSE_STAGE, RESPONSE_STATUS, SENT_STAGE, isPublicTokenFormat, publicPathFor } from "./proposal-sharing";

describe("proposal sharing vocabulary", () => {
  it("validates the token format", () => {
    expect(isPublicTokenFormat("A".repeat(43))).toBe(true);
    expect(isPublicTokenFormat("a-_".repeat(14) + "z")).toBe(true);
    expect(isPublicTokenFormat("A".repeat(42))).toBe(false);
    expect(isPublicTokenFormat("A".repeat(42) + "=")).toBe(false);
    expect(publicPathFor("abc")).toBe("/p/abc");
  });

  it("maps responses to statuses and pipeline stages", () => {
    expect(RESPONSE_STATUS).toEqual({ ACCEPT: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED", REJECT: "REJECTED" });
    expect(RESPONSE_STAGE).toEqual({ ACCEPT: "FECHADO", REQUEST_CHANGES: "NEGOCIACAO", REJECT: "PERDIDO" });
    expect(SENT_STAGE).toBe("PROPOSTA_ENVIADA");
    expect([...CLOSED_STAGES].sort()).toEqual(["FECHADO", "PERDIDO"]);
  });
});
```

Append to `src/components/presentation/presentation-renderer.test.tsx`:

```tsx
describe.each(PROPOSAL_THEMES)("PresentationRenderer with a response — %s", (theme) => {
  it("shows the recorded result instead of the action buttons", () => {
    render(
      <PresentationRenderer
        model={model}
        theme={theme}
        response={{ action: "REQUEST_CHANGES", respondentName: "Maria", respondedAtLabel: "25 de setembro de 2026", message: "Trocar stories" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Aceitar" })).not.toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Ajustes solicitados por Maria em 25 de setembro de 2026.");
    expect(status).toHaveTextContent("Trocar stories");
  });
});

describe("PresentationRenderer response sentences", () => {
  it.each([
    ["ACCEPT", "Proposta aceita por Maria em 25 de setembro de 2026."],
    ["REJECT", "Proposta recusada por Maria em 25 de setembro de 2026."],
  ] as const)("%s", (action, sentence) => {
    render(
      <PresentationRenderer
        model={model}
        response={{ action, respondentName: "Maria", respondedAtLabel: "25 de setembro de 2026", message: null }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(sentence);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/presentation src/lib/proposal-sharing.test.ts src/components/presentation/presentation-renderer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the pure modules**

Append to `src/lib/presentation/types.ts`:

```typescript
export type PresentationResponseAction = "ACCEPT" | "REQUEST_CHANGES" | "REJECT";

export interface PresentationResponse {
  action: PresentationResponseAction;
  respondentName: string;
  respondedAtLabel: string;
  message: string | null;
}
```

Append to `src/lib/presentation/format.ts`:

```typescript
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

/** "25/09/2026, 14:32" (São Paulo). */
export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}
```

```typescript
// src/lib/presentation/present-response.ts
import { formatIssuedAt } from "./format";
import type { PresentationResponse, PresentationResponseAction } from "./types";

export function presentResponse(response: {
  action: PresentationResponseAction;
  respondentName: string;
  respondedAt: Date;
  message: string | null;
}): PresentationResponse {
  return {
    action: response.action,
    respondentName: response.respondentName,
    respondedAtLabel: formatIssuedAt(response.respondedAt),
    message: response.message,
  };
}
```

```typescript
// src/lib/presentation/snapshot-schema.ts
import { z } from "zod";
import type { PresentationSnapshotInput } from "./types";

// Stored JSON (proposal_versions.snapshot_json, proposal_publications.context)
// is untyped jsonb: validate it at the boundary instead of casting.

const snapshotSchema = z.object({
  proposal: z.object({
    title: z.string(),
    status: z.string(),
    theme: z.string().optional(),
    template: z.string().optional(), // snapshots stored before the template -> theme rename
  }),
  items: z.array(
    z.object({ description: z.string(), quantity: z.number().int(), unitPrice: z.number().int(), sortOrder: z.number().int() }),
  ),
  blocks: z.array(z.object({ blockType: z.string(), content: z.unknown() })),
});

export function parsePresentationSnapshot(value: unknown): PresentationSnapshotInput {
  const parsed = snapshotSchema.parse(value);
  return {
    proposal: parsed.proposal,
    items: parsed.items,
    blocks: parsed.blocks.map((block) => ({ blockType: block.blockType, content: block.content })),
  };
}

const contextSchema = z.object({
  creator: z.object({ displayName: z.string(), instagramHandle: z.string().nullable() }),
  clientName: z.string().nullable(),
  issuedAt: z.iso.datetime(),
});

export interface PublicationContext {
  creator: { displayName: string; instagramHandle: string | null };
  clientName: string | null;
  issuedAt: Date;
}

export interface PublicationContextJson {
  creator: { displayName: string; instagramHandle: string | null };
  clientName: string | null;
  issuedAt: string;
}

export function parsePublicationContext(value: unknown): PublicationContext {
  const parsed = contextSchema.parse(value);
  return { creator: parsed.creator, clientName: parsed.clientName, issuedAt: new Date(parsed.issuedAt) };
}

export function toPublicationContextJson(
  parties: { creator: PublicationContext["creator"]; clientName: string | null },
  issuedAt: Date,
): PublicationContextJson {
  return {
    creator: { displayName: parties.creator.displayName, instagramHandle: parties.creator.instagramHandle },
    clientName: parties.clientName,
    issuedAt: issuedAt.toISOString(),
  };
}
```

(zod 4 is installed: `z.iso.datetime()` exists; if the installed version lacks it, use `z.string().datetime()` and note it.)

```typescript
// src/lib/proposal-sharing.ts
import type { ProposalStatus } from "@/lib/proposal-themes";
import type { PresentationResponseAction } from "@/lib/presentation/types";

/** 32 random bytes in base64url. */
export const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isPublicTokenFormat(token: string): boolean {
  return PUBLIC_TOKEN_PATTERN.test(token);
}

export function publicPathFor(token: string): string {
  return `/p/${token}`;
}

export const RESPONSE_STATUS: Record<PresentationResponseAction, ProposalStatus> = {
  ACCEPT: "APPROVED",
  REQUEST_CHANGES: "CHANGES_REQUESTED",
  REJECT: "REJECTED",
};

export const RESPONSE_STAGE: Record<PresentationResponseAction, "NEGOCIACAO" | "FECHADO" | "PERDIDO"> = {
  ACCEPT: "FECHADO",
  REQUEST_CHANGES: "NEGOCIACAO",
  REJECT: "PERDIDO",
};

export const SENT_STAGE = "PROPOSTA_ENVIADA" as const;

/** Opportunities in these stages are never moved by the automation. */
export const CLOSED_STAGES: ReadonlySet<string> = new Set(["FECHADO", "PERDIDO"]);
```

- [ ] **Step 4: Theme result slots**

Add to `ThemeClasses` in `src/components/presentation/theme-types.ts`:

```typescript
  /** Container of the recorded client response (replaces the buttons). */
  resultBox: string;
  resultText: string;
  resultMessage: string;
```

Add to each theme's `classes`:

| Theme file | `resultBox` | `resultText` | `resultMessage` |
|---|---|---|---|
| `premium.ts` | `"flex flex-col items-center gap-2 border-t border-[#3A342A] pt-6 text-center"` | `"text-xl italic text-[#C9A96E]"` | `"max-w-[60ch] text-base text-[#CFC6B8]"` |
| `minimal.ts` | `"flex flex-col gap-2 border-t border-[#EEEEEE] pt-4"` | `"text-base font-medium"` | `"text-sm text-[#555555]"` |
| `editorial.ts` | `"flex flex-col gap-2 border-t-2 border-[#1D1A16] pt-4"` | `"text-xl italic"` | `"text-base text-[#6B5F52]"` |
| `fashion.ts` | `"mx-6 flex flex-col gap-2 border border-black p-4 @xl:mx-12"` | `"text-lg uppercase"` | `"text-sm"` |
| `beauty.ts` | `"flex flex-col items-center gap-2 rounded-2xl bg-white px-5 py-4 text-center"` | `"text-lg text-[#6D3440]"` | `"text-sm text-[#A07A80]"` |
| `corporate.ts` | `"mx-6 flex flex-col gap-1 border border-[#C5CEDB] bg-[#EEF2F7] px-4 py-3 @xl:mx-10"` | `"text-sm font-semibold"` | `"text-sm text-[#3B4557]"` |

- [ ] **Step 5: Renderer** — in `sections.tsx`, change `ActionsSection` to:

```tsx
const RESPONSE_SENTENCE: Record<PresentationResponse["action"], (name: string, date: string) => string> = {
  ACCEPT: (name, date) => `Proposta aceita por ${name} em ${date}.`,
  REQUEST_CHANGES: (name, date) => `Ajustes solicitados por ${name} em ${date}.`,
  REJECT: (name, date) => `Proposta recusada por ${name} em ${date}.`,
};

export function ActionsSection({
  theme,
  onAction,
  response,
}: {
  theme: ThemeDefinition;
  onAction?: (action: PresentationAction) => void;
  response?: PresentationResponse;
}) {
  if (response) {
    return (
      <div role="status" className={theme.classes.resultBox} style={{ fontFamily: theme.fonts.ui }}>
        <p className={theme.classes.resultText} style={{ fontFamily: theme.fonts.display }}>
          {RESPONSE_SENTENCE[response.action](response.respondentName, response.respondedAtLabel)}
        </p>
        {response.message ? (
          <p className={cn("whitespace-pre-line", theme.classes.resultMessage)}>{response.message}</p>
        ) : null}
      </div>
    );
  }

  return (
    // …existing buttons markup unchanged…
  );
}
```

(import `PresentationResponse` from `@/lib/presentation/types`). In `presentation-renderer.tsx` add `response?: PresentationResponse` to the props (doc comment: "Recorded client response: replaces the action buttons.") and pass it: `<ActionsSection theme={definition} onAction={onAction} response={response} />`.

- [ ] **Step 6: Run the tests to see them pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/presentation src/lib/proposal-sharing.test.ts src/components/presentation`
Expected: PASS.

- [ ] **Step 7: Server-free check, full suite, build, commit**

```bash
grep -rn "@/db\|@/services\|@/repositories\|next/headers\|server-only" src/components/presentation src/lib/presentation src/lib/proposal-sharing.ts || echo "server-free"
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/lib src/components/presentation
git commit -m "feat: validate stored snapshots and render client responses in themes"
```

---

### Task 3: Repositories, tenant-transaction options and shared test fixtures

**Files:**
- Create: `src/repositories/proposal-publications.repository.ts`, `src/repositories/proposal-responses.repository.ts`, `src/test/helpers/proposal-fixtures.ts`
- Modify: `src/repositories/tenant-context.ts`, `src/repositories/proposals.repository.ts`, `src/repositories/proposal-versions.repository.ts`, `src/services/proposal-presentation.service.ts`, `src/services/proposal.service.ts` (export `assertMember`)
- Test: `src/repositories/proposal-publications.repository.test.ts`, `src/services/proposal-presentation.service.test.ts` (must keep passing)

**Interfaces:**
- Produces: `runInTenantContext(db, organizationId, fn, config?: PgTransactionConfig)` (config passed to `db.transaction`).
- Produces (`ProposalsRepository`): `lockByIdWithTx(tx, orgId, proposalId): Promise<Proposal | null>` (`SELECT … FOR UPDATE`); `setStatusWithTx(tx, orgId, proposalId, status: Proposal["status"]): Promise<Proposal>`; `setPublicTokenWithTx(tx, orgId, proposalId, token: string): Promise<Proposal>`; `findByPublicToken(db, token): Promise<Proposal | null>` (global lookup, see comment).
- Produces (`ProposalVersionsRepository`): `findLatestWithTx(tx, orgId, proposalId): Promise<ProposalVersion | null>`; `findByIdWithTx(tx, orgId, versionId): Promise<ProposalVersion | null>`.
- Produces (`ProposalPublicationsRepository`): `type ProposalPublication`; `insertWithTx(tx, orgId, input: { proposalId; versionId; versionNumber; context: PublicationContextJson; publishedBy: string; publishedAt: Date }): Promise<ProposalPublication>` (assigns `publicationNumber = max + 1`; caller holds the proposal lock); `findLatestWithTx(tx, orgId, proposalId)`; `findForProposalWithTx(tx, orgId, proposalId, publicationId)`; `listWithResponsesWithTx(tx, orgId, proposalId): Promise<Array<{ publication: ProposalPublication; response: ProposalResponse | null }>>` (latest first).
- Produces (`ProposalResponsesRepository`): `type ProposalResponse`; `insertWithTx(tx, orgId, input: { publicationId; action; respondentName; respondentEmail; message: string | null }): Promise<ProposalResponse>`; `findByPublicationWithTx(tx, orgId, publicationId): Promise<ProposalResponse | null>`.
- Produces (`proposal-presentation.service.ts`): `loadPresentationPartiesWithTx(tx, orgId, opportunity: { creatorId: string; brandId: string | null; companyId: string | null }): Promise<{ creator: { displayName: string; instagramHandle: string | null }; clientName: string | null } | null>` (reused by `loadPreviewSource`).
- Produces (`src/test/helpers/proposal-fixtures.ts`): `seedProposal(db, options?: { theme?: ProposalTheme; opportunityStage?: OpportunityStage }): Promise<{ organization; owner; creator; opportunity; proposal }>` — org + owner + creator "Thais" (`@thais`) + company "Bella Cosméticos" + contact + lead + opportunity + proposal created through `ProposalService.create` (so version 1, COVER and TEXT exist).
- Produces: `export async function assertMember(tx, organizationId, userId)` from `src/services/proposal.service.ts` (unchanged behavior).

- [ ] **Step 1: Write the failing test**

```typescript
// src/repositories/proposal-publications.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { runInTenantContext } from "./tenant-context";
import { ProposalsRepository } from "./proposals.repository";
import { ProposalVersionsRepository } from "./proposal-versions.repository";
import { ProposalPublicationsRepository } from "./proposal-publications.repository";
import { ProposalResponsesRepository } from "./proposal-responses.repository";

const context = {
  creator: { displayName: "Thais", instagramHandle: "@thais" },
  clientName: "Bella Cosméticos",
  issuedAt: "2026-09-25T15:00:00.000Z",
};

describe("publication repositories", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("numbers publications per proposal, finds the latest and lists them with responses", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const orgId = organization.id;

    const result = await runInTenantContext(db, orgId, async (tx) => {
      const locked = await ProposalsRepository.lockByIdWithTx(tx, orgId, proposal.id);
      const version = await ProposalVersionsRepository.findLatestWithTx(tx, orgId, proposal.id);
      const first = await ProposalPublicationsRepository.insertWithTx(tx, orgId, {
        proposalId: proposal.id,
        versionId: version!.id,
        versionNumber: version!.versionNumber,
        context,
        publishedBy: owner.id,
        publishedAt: new Date("2026-09-25T15:00:00Z"),
      });
      const response = await ProposalResponsesRepository.insertWithTx(tx, orgId, {
        publicationId: first.id,
        action: "REQUEST_CHANGES",
        respondentName: "Maria",
        respondentEmail: "maria@x.test",
        message: "Trocar stories",
      });
      const second = await ProposalPublicationsRepository.insertWithTx(tx, orgId, {
        proposalId: proposal.id,
        versionId: version!.id,
        versionNumber: version!.versionNumber,
        context,
        publishedBy: owner.id,
        publishedAt: new Date("2026-09-25T15:00:00Z"),
      });
      return {
        locked,
        version,
        first,
        second,
        response,
        latest: await ProposalPublicationsRepository.findLatestWithTx(tx, orgId, proposal.id),
        foundFirst: await ProposalPublicationsRepository.findForProposalWithTx(tx, orgId, proposal.id, first.id),
        foundResponse: await ProposalResponsesRepository.findByPublicationWithTx(tx, orgId, first.id),
        history: await ProposalPublicationsRepository.listWithResponsesWithTx(tx, orgId, proposal.id),
      };
    });

    expect(result.locked?.id).toBe(proposal.id);
    expect(result.version?.versionNumber).toBe(1);
    expect(result.first.publicationNumber).toBe(1);
    expect(result.second.publicationNumber).toBe(2);
    expect(result.latest?.id).toBe(result.second.id);
    expect(result.foundFirst?.id).toBe(result.first.id);
    expect(result.foundResponse?.id).toBe(result.response.id);
    expect(result.history.map((entry) => [entry.publication.publicationNumber, entry.response?.action ?? null])).toEqual([
      [2, null],
      [1, "REQUEST_CHANGES"],
    ]);
  });

  it("never finds a publication through another proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);

    const publicationOfB = await runInTenantContext(db, b.organization.id, async (tx) => {
      const version = await ProposalVersionsRepository.findLatestWithTx(tx, b.organization.id, b.proposal.id);
      return ProposalPublicationsRepository.insertWithTx(tx, b.organization.id, {
        proposalId: b.proposal.id,
        versionId: version!.id,
        versionNumber: 1,
        context,
        publishedBy: b.owner.id,
        publishedAt: new Date(),
      });
    });

    const found = await runInTenantContext(db, a.organization.id, (tx) =>
      ProposalPublicationsRepository.findForProposalWithTx(tx, a.organization.id, a.proposal.id, publicationOfB.id),
    );
    expect(found).toBeNull();
  });

  it("finds a proposal by its public token and updates status and token without a version", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await seedProposal(db);
    const token = "T".repeat(43);

    await runInTenantContext(db, organization.id, async (tx) => {
      await ProposalsRepository.setPublicTokenWithTx(tx, organization.id, proposal.id, token);
      await ProposalsRepository.setStatusWithTx(tx, organization.id, proposal.id, "SENT");
    });

    const found = await ProposalsRepository.findByPublicToken(db, token);
    expect(found?.id).toBe(proposal.id);
    expect(found?.status).toBe("SENT");
    expect(await ProposalsRepository.findByPublicToken(db, "U".repeat(43))).toBeNull();
    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/repositories/proposal-publications.repository.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/repositories/tenant-context.ts`:

```typescript
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import type * as schema from "@/db/schema";

export async function runInTenantContext<T>(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org_id', ${organizationId}, true)`);
    return fn(tx as unknown as NodePgDatabase<typeof schema>);
  }, config);
}
```

Add to `ProposalsRepository` (import `proposals` already there):

```typescript
  /** Row lock: serializes publish/respond on the same proposal. */
  async lockByIdWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string): Promise<Proposal | null> {
    const [proposal] = await tx
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
      .for("update");
    return proposal ?? null;
  },

  /** Commercial status change from sending/responding: never creates a version. */
  async setStatusWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    status: Proposal["status"],
  ): Promise<Proposal> {
    return updateProposal(tx, organizationId, proposalId, { status });
  },

  async setPublicTokenWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    token: string,
  ): Promise<Proposal> {
    const [proposal] = await tx
      .update(proposals)
      .set({ publicToken: token })
      .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
      .returning();
    if (!proposal) throw new ProposalNotFoundError(proposalId);
    return proposal;
  },

  /**
   * The only lookup without an organization from a session: the public link
   * derives the organization from the proposal it finds. Today the app
   * connects as a superuser so RLS does not filter this; the RLS hardening
   * subproject must give this lookup an explicit privileged path.
   */
  async findByPublicToken(db: NodePgDatabase<typeof schema>, token: string): Promise<Proposal | null> {
    const [proposal] = await db.select().from(proposals).where(eq(proposals.publicToken, token));
    return proposal ?? null;
  },
```

Add to `ProposalVersionsRepository` (add `and`, `desc`, `eq` imports as needed):

```typescript
  async findLatestWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string): Promise<ProposalVersion | null> {
    const [version] = await tx
      .select()
      .from(proposalVersions)
      .where(and(eq(proposalVersions.proposalId, proposalId), eq(proposalVersions.organizationId, organizationId)))
      .orderBy(desc(proposalVersions.versionNumber))
      .limit(1);
    return version ?? null;
  },

  async findByIdWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, versionId: string): Promise<ProposalVersion | null> {
    const [version] = await tx
      .select()
      .from(proposalVersions)
      .where(and(eq(proposalVersions.id, versionId), eq(proposalVersions.organizationId, organizationId)));
    return version ?? null;
  },
```

```typescript
// src/repositories/proposal-publications.repository.ts
import { and, desc, eq, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalPublications, proposalResponses } from "@/db/schema/proposals";
import type { PublicationContextJson } from "@/lib/presentation/snapshot-schema";
import type { ProposalResponse } from "./proposal-responses.repository";

export type ProposalPublication = typeof proposalPublications.$inferSelect;

export interface InsertPublicationInput {
  proposalId: string;
  versionId: string;
  versionNumber: number;
  context: PublicationContextJson;
  publishedBy: string;
  publishedAt: Date;
}

export const ProposalPublicationsRepository = {
  /** Caller must hold the proposal row lock (numbers are max + 1). Publications are insert-only. */
  async insertWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, input: InsertPublicationInput): Promise<ProposalPublication> {
    const [{ current }] = await tx
      .select({ current: max(proposalPublications.publicationNumber) })
      .from(proposalPublications)
      .where(and(eq(proposalPublications.proposalId, input.proposalId), eq(proposalPublications.organizationId, organizationId)));
    const [publication] = await tx
      .insert(proposalPublications)
      .values({ organizationId, publicationNumber: (current ?? 0) + 1, ...input })
      .returning();
    return publication;
  },

  async findLatestWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string): Promise<ProposalPublication | null> {
    const [publication] = await tx
      .select()
      .from(proposalPublications)
      .where(and(eq(proposalPublications.proposalId, proposalId), eq(proposalPublications.organizationId, organizationId)))
      .orderBy(desc(proposalPublications.publicationNumber))
      .limit(1);
    return publication ?? null;
  },

  /** Scoped to one proposal: a publication of another proposal is never found. */
  async findForProposalWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    publicationId: string,
  ): Promise<ProposalPublication | null> {
    const [publication] = await tx
      .select()
      .from(proposalPublications)
      .where(
        and(
          eq(proposalPublications.id, publicationId),
          eq(proposalPublications.proposalId, proposalId),
          eq(proposalPublications.organizationId, organizationId),
        ),
      );
    return publication ?? null;
  },

  async listWithResponsesWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<Array<{ publication: ProposalPublication; response: ProposalResponse | null }>> {
    const rows = await tx
      .select({ publication: proposalPublications, response: proposalResponses })
      .from(proposalPublications)
      .leftJoin(proposalResponses, eq(proposalResponses.publicationId, proposalPublications.id))
      .where(and(eq(proposalPublications.proposalId, proposalId), eq(proposalPublications.organizationId, organizationId)))
      .orderBy(desc(proposalPublications.publicationNumber));
    return rows.map((row) => ({ publication: row.publication, response: row.response ?? null }));
  },
};
```

```typescript
// src/repositories/proposal-responses.repository.ts
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalResponses } from "@/db/schema/proposals";

export type ProposalResponse = typeof proposalResponses.$inferSelect;

export interface InsertResponseInput {
  publicationId: string;
  action: ProposalResponse["action"];
  respondentName: string;
  respondentEmail: string;
  message: string | null;
}

export const ProposalResponsesRepository = {
  /** Insert-only; the unique publication_id enforces one response per publication. */
  async insertWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, input: InsertResponseInput): Promise<ProposalResponse> {
    const [response] = await tx
      .insert(proposalResponses)
      .values({ organizationId, ...input })
      .returning();
    return response;
  },

  async findByPublicationWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, publicationId: string): Promise<ProposalResponse | null> {
    const [response] = await tx
      .select()
      .from(proposalResponses)
      .where(and(eq(proposalResponses.publicationId, publicationId), eq(proposalResponses.organizationId, organizationId)));
    return response ?? null;
  },
};
```

In `src/services/proposal-presentation.service.ts`, extract the creator + client lookup into an exported function and use it inside `loadPreviewSource` (behavior unchanged):

```typescript
export async function loadPresentationPartiesWithTx(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  opportunity: { creatorId: string; brandId: string | null; companyId: string | null },
): Promise<{ creator: { displayName: string; instagramHandle: string | null }; clientName: string | null } | null> {
  const creator = await CreatorsRepository.findByIdWithTx(tx, organizationId, opportunity.creatorId);
  if (!creator) return null;
  const clientName = await resolveClientName(tx, organizationId, opportunity.brandId, opportunity.companyId);
  return { creator: { displayName: creator.displayName, instagramHandle: creator.instagramHandle }, clientName };
}
```

In `src/services/proposal.service.ts` change `async function assertMember(` to `export async function assertMember(`.

```typescript
// src/test/helpers/proposal-fixtures.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import type * as schema from "@/db/schema";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ProposalService } from "@/services/proposal.service";
import { companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import type { ProposalTheme } from "@/lib/proposal-themes";

type OpportunityStage = (typeof opportunities.$inferSelect)["stage"];

let counter = 0;

/** Org + owner + creator Thais (@thais) + Bella Cosméticos + opportunity + proposal (version 1, COVER, TEXT). */
export async function seedProposal(
  db: NodePgDatabase<typeof schema>,
  options: { theme?: ProposalTheme; opportunityStage?: OpportunityStage } = {},
) {
  counter += 1;
  const suffix = `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  const { organization, owner } = await OrganizationService.createWithOwner(db, {
    organizationName: `Org ${suffix}`,
    ownerEmail: `owner-${suffix}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const creator = await CreatorService.onboardCreator(db, organization.id, {
    email: `creator-${suffix}@publyflow.test`,
    fullName: "Thais",
    displayName: "Thais",
    instagramHandle: "@thais",
  });
  const [company] = await db.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }).returning();
  const [contact] = await db
    .insert(contacts)
    .values({ organizationId: organization.id, companyId: company.id, fullName: "Maria Fernandes" })
    .returning();
  const [lead] = await db
    .insert(leads)
    .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, companyId: company.id, qualified: true })
    .returning();
  let [opportunity] = await db
    .insert(opportunities)
    .values({ organizationId: organization.id, creatorId: creator.id, leadId: lead.id, companyId: company.id, brandId: null })
    .returning();
  if (options.opportunityStage) {
    [opportunity] = await db
      .update(opportunities)
      .set({ stage: options.opportunityStage })
      .where(eq(opportunities.id, opportunity.id))
      .returning();
  }
  const proposal = await ProposalService.create(db, organization.id, {
    opportunityId: opportunity.id,
    title: "Campanha Verão",
    theme: options.theme ?? "PREMIUM",
    userId: owner.id,
  });
  return { organization, owner, creator, opportunity, proposal };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/repositories/proposal-publications.repository.test.ts src/services/proposal-presentation.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/repositories src/services src/test/helpers
git commit -m "feat: add publication and response repositories"
```

---

### Task 4: Sending — publish, send-state, history, pipeline on send

**Files:**
- Create: `src/services/proposal-pipeline.ts`, `src/services/proposal-sending.service.ts`, `src/test/helpers/proposal-invariants.ts`
- Modify: `src/domain/proposals/errors.ts`
- Test: `src/services/proposal-sending.service.test.ts`

**Interfaces:**
- Consumes: Task 3 repositories, `assertMember`, `loadPresentationPartiesWithTx`, `seedProposal`; Task 2 `toPublicationContextJson`, `publicPathFor`, `SENT_STAGE`, `CLOSED_STAGES`; `PUBLIC_PROPOSAL_STATUSES`, `ProposalStatus` (Task 1); `OpportunitiesRepository.findByIdWithTx` / `updateStageWithTx`.
- Produces (errors): `ProposalArchivedError(proposalId)`, `ProposalUnavailableError()`, `PublicProposalNotFoundError()`, `PublicationSupersededError()`, `PublicationAlreadyRespondedError()`, `ProposalStatusTransitionError(from, to)`.
- Produces (`proposal-pipeline.ts`): `moveOpportunityIfOpenWithTx(tx, orgId, opportunityId, stage): Promise<void>`.
- Produces (`proposal-sending.service.ts`):
  - `generatePublicToken(): string`
  - `computeSendFlags(input: { status: ProposalStatus; latestVersionNumber: number; latestPublicationVersionNumber: number | null }): { hasUnsentChanges: boolean; canSend: boolean }`
  - `interface SendState { status; publicPath: string | null; latestPublication: { id; versionNumber; publishedAt: Date; response: { action; respondentName; respondentEmail; message: string | null; respondedAt: Date } | null } | null; latestVersionNumber: number; hasUnsentChanges: boolean; canSend: boolean }`
  - `interface PublicationHistoryItem { id; publicationNumber; versionNumber; publishedAt: Date; response: SendState["latestPublication"]["response"] }`
  - `ProposalSendingService.publish(db, orgId, proposalId, userId): Promise<{ publication: ProposalPublication; publicPath: string; created: boolean }>`
  - `ProposalSendingService.getSendState(db, orgId, proposalId): Promise<SendState | null>`
  - `ProposalSendingService.listPublications(db, orgId, proposalId): Promise<PublicationHistoryItem[] | null>`
- Produces (`proposal-invariants.ts`): `expectProposalInvariants(db, orgId, proposalId): Promise<void>` (asserts spec invariants 1–4 with `expect`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/proposal-sending.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { expectProposalInvariants } from "@/test/helpers/proposal-invariants";
import { ProposalService } from "./proposal.service";
import { ProposalSendingService, computeSendFlags } from "./proposal-sending.service";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { ProposalArchivedError } from "@/domain/proposals/errors";
import { opportunities, opportunityStageHistory } from "@/db/schema/commercial-flow";
import { creators } from "@/db/schema/creators";

describe("computeSendFlags (spec §5.2)", () => {
  it.each([
    ["DRAFT", 1, null, true, true],
    ["DRAFT", 3, 3, false, true],
    ["SENT", 2, 2, false, false],
    ["SENT", 3, 2, true, true],
    ["CHANGES_REQUESTED", 2, 2, false, false],
    ["CHANGES_REQUESTED", 3, 2, true, true],
    ["APPROVED", 2, 2, false, false],
    ["APPROVED", 3, 2, true, true],
    ["REJECTED", 2, 2, false, false],
    ["REJECTED", 3, 2, true, true],
    ["ARCHIVED", 3, 2, true, false],
  ] as const)("%s latest v%s published v%s", (status, latest, published, hasUnsentChanges, canSend) => {
    expect(computeSendFlags({ status, latestVersionNumber: latest, latestPublicationVersionNumber: published })).toEqual({
      hasUnsentChanges,
      canSend,
    });
  });
});

describe("ProposalSendingService.publish", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("first send: token, frozen context, SENT, PROPOSTA_ENVIADA with history, no new version", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity, proposal } = await seedProposal(db);

    const result = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    expect(result.created).toBe(true);
    expect(result.publicPath).toMatch(/^\/p\/[A-Za-z0-9_-]{43}$/);
    expect(result.publication.versionNumber).toBe(1);
    expect(result.publication.publicationNumber).toBe(1);
    expect(result.publication.context).toMatchObject({
      creator: { displayName: "Thais", instagramHandle: "@thais" },
      clientName: "Bella Cosméticos",
    });
    expect(await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id)).toHaveLength(1);

    const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(opp.stage).toBe("PROPOSTA_ENVIADA");
    const history = await db.select().from(opportunityStageHistory).where(eq(opportunityStageHistory.opportunityId, opportunity.id));
    expect(history.some((row) => row.toStage === "PROPOSTA_ENVIADA")).toBe(true);

    const state = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(state).toMatchObject({ status: "SENT", publicPath: result.publicPath, hasUnsentChanges: false, canSend: false, latestVersionNumber: 1 });
    await expectProposalInvariants(db, organization.id, proposal.id);
  });

  it("is idempotent without changes and keeps the same token", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);

    const first = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const again = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    expect(again.created).toBe(false);
    expect(again.publication.id).toBe(first.publication.id);
    expect(again.publicPath).toBe(first.publicPath);
  });

  it("after an edit creates a new publication of the latest version and keeps the previous one", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);

    const first = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalService.update(db, organization.id, proposal.id, { title: "Campanha Verão v2", userId: owner.id });

    const edited = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(edited).toMatchObject({ status: "SENT", hasUnsentChanges: true, canSend: true, latestVersionNumber: 2 });

    const second = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    expect(second.created).toBe(true);
    expect(second.publication.versionNumber).toBe(2);
    expect(second.publication.publicationNumber).toBe(2);
    expect(second.publicPath).toBe(first.publicPath);

    const history = await ProposalSendingService.listPublications(db, organization.id, proposal.id);
    expect(history?.map((item) => item.versionNumber)).toEqual([2, 1]);
    await expectProposalInvariants(db, organization.id, proposal.id);
  });

  it("freezes the context: renaming the creator afterwards does not change the publication", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal } = await seedProposal(db);

    const { publication } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await db.update(creators).set({ displayName: "Thais Nova" }).where(eq(creators.id, creator.id));

    const history = await ProposalSendingService.listPublications(db, organization.id, proposal.id);
    expect(history?.[0].id).toBe(publication.id);
    expect((publication.context as { creator: { displayName: string } }).creator.displayName).toBe("Thais");
  });

  it("refuses an archived proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });

    await expect(ProposalSendingService.publish(db, organization.id, proposal.id, owner.id)).rejects.toBeInstanceOf(
      ProposalArchivedError,
    );
  });

  it("does not move a closed opportunity", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity, proposal } = await seedProposal(db, { opportunityStage: "PERDIDO" });

    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(opp.stage).toBe("PERDIDO");
  });

  it("resending from DRAFT (unarchived) always creates a publication and re-enables the link", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);

    const first = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    await ProposalService.update(db, organization.id, proposal.id, { status: "DRAFT", userId: owner.id });

    const drafted = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(drafted).toMatchObject({ status: "DRAFT", publicPath: null, canSend: true });

    const again = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    expect(again.created).toBe(true);
    expect(again.publicPath).toBe(first.publicPath);
    await expectProposalInvariants(db, organization.id, proposal.id);
  });

  it("two concurrent sends after an edit create exactly one publication (idempotent under concurrency)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalService.update(db, organization.id, proposal.id, { title: "v2", userId: owner.id });

    const results = await Promise.all([
      ProposalSendingService.publish(db, organization.id, proposal.id, owner.id),
      ProposalSendingService.publish(db, organization.id, proposal.id, owner.id),
    ]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(results[0].publication.id).toBe(results[1].publication.id);
    const history = await ProposalSendingService.listPublications(db, organization.id, proposal.id);
    expect(history).toHaveLength(2);
  });

  it("returns null state/history for a proposal of another organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);

    expect(await ProposalSendingService.getSendState(db, b.organization.id, a.proposal.id)).toBeNull();
    expect(await ProposalSendingService.listPublications(db, b.organization.id, a.proposal.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/services/proposal-sending.service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Errors** — append to `src/domain/proposals/errors.ts`:

```typescript
// Sending an archived proposal: it must be unarchived first.
export class ProposalArchivedError extends Error {
  constructor(proposalId: string) {
    super(`Proposal ${proposalId} is archived`);
    this.name = "ProposalArchivedError";
  }
}

// The public link exists but the proposal is DRAFT or ARCHIVED.
export class ProposalUnavailableError extends Error {
  constructor() {
    super("Esta proposta não está mais disponível.");
    this.name = "ProposalUnavailableError";
  }
}

// Unknown or malformed public token.
export class PublicProposalNotFoundError extends Error {
  constructor() {
    super("Proposta não encontrada.");
    this.name = "PublicProposalNotFoundError";
  }
}

// The client answered a publication that is not the proposal's latest
// (old, nonexistent or another proposal's).
export class PublicationSupersededError extends Error {
  readonly code = "SUPERSEDED";
  constructor() {
    super("Esta proposta foi atualizada. Recarregue para ver a versão atual.");
    this.name = "PublicationSupersededError";
  }
}

export class PublicationAlreadyRespondedError extends Error {
  readonly code = "ALREADY_RESPONDED";
  constructor() {
    super("Esta proposta já foi respondida.");
    this.name = "PublicationAlreadyRespondedError";
  }
}

// PATCH may only move to DRAFT from ARCHIVED (unarchive); the commercial
// statuses change only by sending or by the client's response.
export class ProposalStatusTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Proposal status cannot change from ${from} to ${to}`);
    this.name = "ProposalStatusTransitionError";
  }
}
```

- [ ] **Step 4: Pipeline helper, service and invariants helper**

```typescript
// src/services/proposal-pipeline.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { OpportunitiesRepository, type Opportunity } from "@/repositories/opportunities.repository";
import { CLOSED_STAGES } from "@/lib/proposal-sharing";

/** Moves the opportunity (with stage history) unless it is already closed. */
export async function moveOpportunityIfOpenWithTx(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  opportunityId: string,
  stage: Opportunity["stage"],
): Promise<void> {
  const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, opportunityId);
  if (!opportunity || CLOSED_STAGES.has(opportunity.stage)) return;
  await OpportunitiesRepository.updateStageWithTx(tx, organizationId, opportunityId, stage);
}
```

(If `Opportunity` isn't exported from the opportunities repository, export it — `export type Opportunity = typeof opportunities.$inferSelect;` — or import the type from where it lives.)

```typescript
// src/services/proposal-sending.service.ts
import { randomBytes } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { ProposalPublicationsRepository, type ProposalPublication } from "@/repositories/proposal-publications.repository";
import { ProposalResponsesRepository, type ProposalResponse } from "@/repositories/proposal-responses.repository";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { assertMember } from "./proposal.service";
import { loadPresentationPartiesWithTx } from "./proposal-presentation.service";
import { moveOpportunityIfOpenWithTx } from "./proposal-pipeline";
import { toPublicationContextJson } from "@/lib/presentation/snapshot-schema";
import { publicPathFor, SENT_STAGE } from "@/lib/proposal-sharing";
import { PUBLIC_PROPOSAL_STATUSES, type ProposalStatus } from "@/lib/proposal-themes";
import { OpportunityNotFoundError, ProposalArchivedError, ProposalNotFoundError } from "@/domain/proposals/errors";

export function generatePublicToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Spec §2/§5.2. `canSend` informs the UI; publish() is the authority. */
export function computeSendFlags(input: {
  status: ProposalStatus;
  latestVersionNumber: number;
  latestPublicationVersionNumber: number | null;
}): { hasUnsentChanges: boolean; canSend: boolean } {
  const hasUnsentChanges =
    input.latestPublicationVersionNumber === null || input.latestVersionNumber !== input.latestPublicationVersionNumber;
  const canSend = input.status !== "ARCHIVED" && (input.status === "DRAFT" || hasUnsentChanges);
  return { hasUnsentChanges, canSend };
}

export interface SendStateResponse {
  action: ProposalResponse["action"];
  respondentName: string;
  respondentEmail: string;
  message: string | null;
  respondedAt: Date;
}

export interface SendState {
  status: ProposalStatus;
  publicPath: string | null;
  latestPublication: { id: string; versionNumber: number; publishedAt: Date; response: SendStateResponse | null } | null;
  latestVersionNumber: number;
  hasUnsentChanges: boolean;
  canSend: boolean;
}

export interface PublicationHistoryItem {
  id: string;
  publicationNumber: number;
  versionNumber: number;
  publishedAt: Date;
  response: SendStateResponse | null;
}

function toResponseView(response: ProposalResponse | null): SendStateResponse | null {
  if (!response) return null;
  return {
    action: response.action,
    respondentName: response.respondentName,
    respondentEmail: response.respondentEmail,
    message: response.message,
    respondedAt: response.respondedAt,
  };
}

export const ProposalSendingService = {
  async publish(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    userId: string,
  ): Promise<{ publication: ProposalPublication; publicPath: string; created: boolean }> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, userId);

      const proposal = await ProposalsRepository.lockByIdWithTx(tx, organizationId, proposalId);
      if (!proposal) throw new ProposalNotFoundError(proposalId);
      if (proposal.status === "ARCHIVED") throw new ProposalArchivedError(proposalId);

      const token = proposal.publicToken ?? generatePublicToken();
      if (!proposal.publicToken) {
        await ProposalsRepository.setPublicTokenWithTx(tx, organizationId, proposalId, token);
      }

      const latestVersion = await ProposalVersionsRepository.findLatestWithTx(tx, organizationId, proposalId);
      if (!latestVersion) throw new ProposalNotFoundError(proposalId);
      const latestPublication = await ProposalPublicationsRepository.findLatestWithTx(tx, organizationId, proposalId);

      // Idempotent (also under concurrency: the second caller waits on the
      // row lock and then sees the version already published).
      if (
        proposal.status !== "DRAFT" &&
        latestPublication &&
        latestPublication.versionNumber === latestVersion.versionNumber
      ) {
        return { publication: latestPublication, publicPath: publicPathFor(token), created: false };
      }

      const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, proposal.opportunityId);
      if (!opportunity) throw new OpportunityNotFoundError(proposal.opportunityId);
      const parties = await loadPresentationPartiesWithTx(tx, organizationId, opportunity);
      if (!parties) throw new OpportunityNotFoundError(proposal.opportunityId);

      const publishedAt = new Date();
      const publication = await ProposalPublicationsRepository.insertWithTx(tx, organizationId, {
        proposalId,
        versionId: latestVersion.id,
        versionNumber: latestVersion.versionNumber,
        context: toPublicationContextJson(parties, publishedAt),
        publishedBy: userId,
        publishedAt,
      });

      await ProposalsRepository.setStatusWithTx(tx, organizationId, proposalId, "SENT");
      await moveOpportunityIfOpenWithTx(tx, organizationId, proposal.opportunityId, SENT_STAGE);

      return { publication, publicPath: publicPathFor(token), created: true };
    });
  },

  /** One consistent read (REPEATABLE READ): proposal, latest version, latest publication, response. */
  async getSendState(db: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string): Promise<SendState | null> {
    return runInTenantContext(
      db,
      organizationId,
      async (tx) => {
        const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
        if (!proposal) return null;
        const latestVersion = await ProposalVersionsRepository.findLatestWithTx(tx, organizationId, proposalId);
        const latestPublication = await ProposalPublicationsRepository.findLatestWithTx(tx, organizationId, proposalId);
        const response = latestPublication
          ? await ProposalResponsesRepository.findByPublicationWithTx(tx, organizationId, latestPublication.id)
          : null;

        const status = proposal.status as ProposalStatus;
        const latestVersionNumber = latestVersion?.versionNumber ?? 0;
        const flags = computeSendFlags({
          status,
          latestVersionNumber,
          latestPublicationVersionNumber: latestPublication?.versionNumber ?? null,
        });

        return {
          status,
          publicPath:
            proposal.publicToken && PUBLIC_PROPOSAL_STATUSES.includes(status) ? publicPathFor(proposal.publicToken) : null,
          latestPublication: latestPublication
            ? {
                id: latestPublication.id,
                versionNumber: latestPublication.versionNumber,
                publishedAt: latestPublication.publishedAt,
                response: toResponseView(response),
              }
            : null,
          latestVersionNumber,
          ...flags,
        };
      },
      { isolationLevel: "repeatable read" },
    );
  },

  async listPublications(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<PublicationHistoryItem[] | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
      if (!proposal) return null;
      const rows = await ProposalPublicationsRepository.listWithResponsesWithTx(tx, organizationId, proposalId);
      return rows.map(({ publication, response }) => ({
        id: publication.id,
        publicationNumber: publication.publicationNumber,
        versionNumber: publication.versionNumber,
        publishedAt: publication.publishedAt,
        response: toResponseView(response),
      }));
    });
  },
};
```

```typescript
// src/test/helpers/proposal-invariants.ts
import { expect } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { ProposalPublicationsRepository } from "@/repositories/proposal-publications.repository";
import { ProposalResponsesRepository } from "@/repositories/proposal-responses.repository";

const EXPECTED_ACTION = { CHANGES_REQUESTED: "REQUEST_CHANGES", APPROVED: "ACCEPT", REJECTED: "REJECT" } as const;

/** Spec §2 invariants 1–4 for one proposal. */
export async function expectProposalInvariants(db: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string) {
  await runInTenantContext(db, organizationId, async (tx) => {
    const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
    expect(proposal).not.toBeNull();
    const latestVersion = await ProposalVersionsRepository.findLatestWithTx(tx, organizationId, proposalId);
    const latest = await ProposalPublicationsRepository.findLatestWithTx(tx, organizationId, proposalId);
    const response = latest ? await ProposalResponsesRepository.findByPublicationWithTx(tx, organizationId, latest.id) : null;
    const status = proposal!.status;

    if (["SENT", "CHANGES_REQUESTED", "APPROVED", "REJECTED"].includes(status)) {
      expect(latest, `status ${status} requires a publication`).not.toBeNull();
    }
    if (status === "SENT") {
      expect(response, "SENT requires the latest publication to be unanswered").toBeNull();
    }
    if (status === "CHANGES_REQUESTED" || status === "APPROVED" || status === "REJECTED") {
      expect(response?.action).toBe(EXPECTED_ACTION[status]);
    }
    if (latest) {
      expect(latest.versionNumber).toBeLessThanOrEqual(latestVersion!.versionNumber);
    }
  });
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/services/proposal-sending.service.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/services src/domain src/repositories src/test/helpers
git commit -m "feat: publish proposals with frozen context and send-state"
```

---

### Task 5: Client response and the public loader

**Files:**
- Create: `src/services/proposal-response.service.ts`, `src/services/public-proposal.service.ts`
- Test: `src/services/proposal-response.service.test.ts`, `src/services/public-proposal.service.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces (`proposal-response.service.ts`): `interface RespondInput { publicationId: string; action: "ACCEPT" | "REQUEST_CHANGES" | "REJECT"; name: string; email: string; message: string | null }`; `ProposalResponseService.respond(db, token, input): Promise<ProposalResponse>` — throws `PublicProposalNotFoundError`, `ProposalUnavailableError`, `PublicationSupersededError`, `PublicationAlreadyRespondedError`.
- Produces (`public-proposal.service.ts`):
  ```typescript
  export type PublicProposalResult =
    | { state: "not_found" }
    | { state: "unavailable" }
    | {
        state: "available";
        title: string;
        publicationId: string;
        versionNumber: number;
        publishedAt: Date;
        snapshot: PresentationSnapshotInput;
        context: PublicationContext;
        response: { action: "ACCEPT" | "REQUEST_CHANGES" | "REJECT"; respondentName: string; respondedAt: Date; message: string | null } | null;
      };
  export const PublicProposalService: { loadByToken(db, token: string): Promise<PublicProposalResult> };
  ```

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/proposal-response.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { expectProposalInvariants } from "@/test/helpers/proposal-invariants";
import { ProposalService } from "./proposal.service";
import { ProposalSendingService } from "./proposal-sending.service";
import { ProposalResponseService } from "./proposal-response.service";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import {
  ProposalUnavailableError,
  PublicProposalNotFoundError,
  PublicationAlreadyRespondedError,
  PublicationSupersededError,
} from "@/domain/proposals/errors";
import { opportunities } from "@/db/schema/commercial-flow";

function tokenOf(publicPath: string) {
  return publicPath.replace("/p/", "");
}

const maria = { name: "Maria Fernandes", email: "maria@bella.test" };

describe("ProposalResponseService.respond", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it.each([
    ["ACCEPT", "APPROVED", "FECHADO", null],
    ["REQUEST_CHANGES", "CHANGES_REQUESTED", "NEGOCIACAO", "Trocar 2 stories por 1 reel"],
    ["REJECT", "REJECTED", "PERDIDO", null],
  ] as const)("%s → %s and opportunity %s, without a new version", async (action, status, stage, message) => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    const response = await ProposalResponseService.respond(db, tokenOf(publicPath), {
      publicationId: publication.id,
      action,
      ...maria,
      message,
    });

    expect(response.action).toBe(action);
    const state = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(state?.status).toBe(status);
    const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(opp.stage).toBe(stage);
    expect(await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id)).toHaveLength(1);
    await expectProposalInvariants(db, organization.id, proposal.id);
  });

  it("does not move a closed opportunity but still updates the proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity, proposal } = await seedProposal(db, { opportunityStage: "FECHADO" });
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    await ProposalResponseService.respond(db, tokenOf(publicPath), { publicationId: publication.id, action: "REJECT", ...maria, message: null });

    const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(opp.stage).toBe("FECHADO");
    expect((await ProposalSendingService.getSendState(db, organization.id, proposal.id))?.status).toBe("REJECTED");
  });

  it("refuses a second response to the same publication", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const input = { publicationId: publication.id, action: "ACCEPT" as const, ...maria, message: null };

    await ProposalResponseService.respond(db, tokenOf(publicPath), input);
    await expect(ProposalResponseService.respond(db, tokenOf(publicPath), input)).rejects.toBeInstanceOf(
      PublicationAlreadyRespondedError,
    );
  });

  it("answers SUPERSEDED for an old publication, a nonexistent id and another proposal's publication", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    const first = await ProposalSendingService.publish(db, a.organization.id, a.proposal.id, a.owner.id);
    await ProposalService.update(db, a.organization.id, a.proposal.id, { title: "v2", userId: a.owner.id });
    await ProposalSendingService.publish(db, a.organization.id, a.proposal.id, a.owner.id);
    const publicationOfB = await ProposalSendingService.publish(db, b.organization.id, b.proposal.id, b.owner.id);
    const tokenA = tokenOf(first.publicPath);

    for (const publicationId of [first.publication.id, "00000000-0000-4000-8000-000000000000", publicationOfB.publication.id]) {
      await expect(
        ProposalResponseService.respond(db, tokenA, { publicationId, action: "ACCEPT", ...maria, message: null }),
      ).rejects.toBeInstanceOf(PublicationSupersededError);
    }
    // B untouched: token(A) + publicationId(B) never reaches B.
    expect((await ProposalSendingService.getSendState(db, b.organization.id, b.proposal.id))?.status).toBe("SENT");
  });

  it("refuses unknown tokens and unavailable proposals", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const input = { publicationId: publication.id, action: "ACCEPT" as const, ...maria, message: null };

    await expect(ProposalResponseService.respond(db, "not-a-token", input)).rejects.toBeInstanceOf(PublicProposalNotFoundError);
    await expect(ProposalResponseService.respond(db, "Z".repeat(43), input)).rejects.toBeInstanceOf(PublicProposalNotFoundError);

    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    await expect(ProposalResponseService.respond(db, tokenOf(publicPath), input)).rejects.toBeInstanceOf(ProposalUnavailableError);
  });

  it("two concurrent responses: exactly one is recorded", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    const results = await Promise.allSettled([
      ProposalResponseService.respond(db, tokenOf(publicPath), { publicationId: publication.id, action: "ACCEPT", ...maria, message: null }),
      ProposalResponseService.respond(db, tokenOf(publicPath), { publicationId: publication.id, action: "REJECT", ...maria, message: null }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(PublicationAlreadyRespondedError);
    await expectProposalInvariants(db, organization.id, proposal.id);
  });

  it("regression: approved → edit → resend opens a new round and keeps the approval on V1", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const v1 = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalResponseService.respond(db, tokenOf(v1.publicPath), { publicationId: v1.publication.id, action: "ACCEPT", ...maria, message: null });

    await ProposalService.update(db, organization.id, proposal.id, { title: "Campanha Verão v2", userId: owner.id });
    const edited = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(edited).toMatchObject({ status: "APPROVED", hasUnsentChanges: true, canSend: true });
    expect(edited?.latestPublication?.response?.action).toBe("ACCEPT");

    const v2 = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const resent = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(resent).toMatchObject({ status: "SENT", hasUnsentChanges: false });
    expect(resent?.latestPublication?.versionNumber).toBe(v2.publication.versionNumber);
    expect(resent?.latestPublication?.response).toBeNull();

    const history = await ProposalSendingService.listPublications(db, organization.id, proposal.id);
    expect(history?.map((item) => item.response?.action ?? null)).toEqual([null, "ACCEPT"]);
    await expectProposalInvariants(db, organization.id, proposal.id);
  });
});
```

```typescript
// src/services/public-proposal.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalService } from "./proposal.service";
import { ProposalSendingService } from "./proposal-sending.service";
import { ProposalResponseService } from "./proposal-response.service";
import { PublicProposalService } from "./public-proposal.service";
import { creators } from "@/db/schema/creators";
import { proposalVersions } from "@/db/schema/proposals";

function tokenOf(publicPath: string) {
  return publicPath.replace("/p/", "");
}

describe("PublicProposalService.loadByToken", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("loads the latest publication with validated snapshot and frozen context", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal } = await seedProposal(db, { theme: "EDITORIAL" });
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await db.update(creators).set({ displayName: "Outro Nome" }).where(eq(creators.id, creator.id));

    const result = await PublicProposalService.loadByToken(db, tokenOf(publicPath));

    expect(result.state).toBe("available");
    if (result.state !== "available") return;
    expect(result.publicationId).toBe(publication.id);
    expect(result.title).toBe("Campanha Verão");
    expect(result.snapshot.proposal.theme).toBe("EDITORIAL");
    expect(result.context.creator.displayName).toBe("Thais");
    expect(result.context.clientName).toBe("Bella Cosméticos");
    expect(result.context.issuedAt).toBeInstanceOf(Date);
    expect(result.response).toBeNull();
  });

  it("shows the recorded response and follows the token to the newest publication", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const v1 = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalResponseService.respond(db, tokenOf(v1.publicPath), {
      publicationId: v1.publication.id,
      action: "REQUEST_CHANGES",
      name: "Maria",
      email: "maria@x.test",
      message: "Trocar stories",
    });

    const answered = await PublicProposalService.loadByToken(db, tokenOf(v1.publicPath));
    expect(answered.state === "available" && answered.response?.message).toBe("Trocar stories");

    await ProposalService.update(db, organization.id, proposal.id, { title: "v2", userId: owner.id });
    const v2 = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const next = await PublicProposalService.loadByToken(db, tokenOf(v1.publicPath));
    expect(next.state === "available" && next.publicationId).toBe(v2.publication.id);
    expect(next.state === "available" && next.response).toBeNull();
  });

  it("not_found for malformed or unknown tokens; unavailable without content for DRAFT/ARCHIVED", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    expect(await PublicProposalService.loadByToken(db, "abc")).toEqual({ state: "not_found" });
    expect(await PublicProposalService.loadByToken(db, "Q".repeat(43))).toEqual({ state: "not_found" });

    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    expect(await PublicProposalService.loadByToken(db, tokenOf(publicPath))).toEqual({ state: "unavailable" });
    await ProposalService.update(db, organization.id, proposal.id, { status: "DRAFT", userId: owner.id });
    expect(await PublicProposalService.loadByToken(db, tokenOf(publicPath))).toEqual({ state: "unavailable" });
  });

  it("accepts a legacy snapshot with `template` and rejects a corrupted one", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    // Rewriting a version is only possible because proposal_versions has no
    // immutability trigger; this simulates rows stored before the rename.
    await db
      .update(proposalVersions)
      .set({ snapshotJson: { proposal: { title: "Antiga", template: "FASHION", status: "DRAFT" }, items: [], blocks: [] } })
      .where(eq(proposalVersions.id, publication.versionId));
    const legacy = await PublicProposalService.loadByToken(db, tokenOf(publicPath));
    expect(legacy.state === "available" && legacy.snapshot.proposal.template).toBe("FASHION");

    await db.update(proposalVersions).set({ snapshotJson: { broken: true } }).where(eq(proposalVersions.id, publication.versionId));
    await expect(PublicProposalService.loadByToken(db, tokenOf(publicPath))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/services/proposal-response.service.test.ts src/services/public-proposal.service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/services/proposal-response.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalPublicationsRepository } from "@/repositories/proposal-publications.repository";
import { ProposalResponsesRepository, type ProposalResponse } from "@/repositories/proposal-responses.repository";
import { moveOpportunityIfOpenWithTx } from "./proposal-pipeline";
import { isPublicTokenFormat, RESPONSE_STAGE, RESPONSE_STATUS } from "@/lib/proposal-sharing";
import { PUBLIC_PROPOSAL_STATUSES, type ProposalStatus } from "@/lib/proposal-themes";
import {
  ProposalUnavailableError,
  PublicProposalNotFoundError,
  PublicationAlreadyRespondedError,
  PublicationSupersededError,
} from "@/domain/proposals/errors";

export interface RespondInput {
  publicationId: string;
  action: "ACCEPT" | "REQUEST_CHANGES" | "REJECT";
  name: string;
  email: string;
  message: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === "23505";
}

export const ProposalResponseService = {
  /** Public, no session: token → proposal → latest publication, all inside one locked transaction. */
  async respond(db: NodePgDatabase<typeof schema>, token: string, input: RespondInput): Promise<ProposalResponse> {
    if (!isPublicTokenFormat(token)) throw new PublicProposalNotFoundError();
    const found = await ProposalsRepository.findByPublicToken(db, token);
    if (!found) throw new PublicProposalNotFoundError();
    const organizationId = found.organizationId;

    try {
      return await runInTenantContext(db, organizationId, async (tx) => {
        const proposal = await ProposalsRepository.lockByIdWithTx(tx, organizationId, found.id);
        if (!proposal || !PUBLIC_PROPOSAL_STATUSES.includes(proposal.status as ProposalStatus)) {
          throw new ProposalUnavailableError();
        }

        const latest = await ProposalPublicationsRepository.findLatestWithTx(tx, organizationId, proposal.id);
        if (!latest || latest.id !== input.publicationId) throw new PublicationSupersededError();

        const existing = await ProposalResponsesRepository.findByPublicationWithTx(tx, organizationId, latest.id);
        if (existing) throw new PublicationAlreadyRespondedError();

        const response = await ProposalResponsesRepository.insertWithTx(tx, organizationId, {
          publicationId: latest.id,
          action: input.action,
          respondentName: input.name,
          respondentEmail: input.email,
          message: input.message,
        });
        await ProposalsRepository.setStatusWithTx(tx, organizationId, proposal.id, RESPONSE_STATUS[input.action]);
        await moveOpportunityIfOpenWithTx(tx, organizationId, proposal.opportunityId, RESPONSE_STAGE[input.action]);
        return response;
      });
    } catch (error) {
      // Belt and braces: the unique publication_id also rejects a race.
      if (isUniqueViolation(error)) throw new PublicationAlreadyRespondedError();
      throw error;
    }
  },
};
```

```typescript
// src/services/public-proposal.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { ProposalPublicationsRepository } from "@/repositories/proposal-publications.repository";
import { ProposalResponsesRepository } from "@/repositories/proposal-responses.repository";
import { isPublicTokenFormat } from "@/lib/proposal-sharing";
import { PUBLIC_PROPOSAL_STATUSES, type ProposalStatus } from "@/lib/proposal-themes";
import { parsePresentationSnapshot, parsePublicationContext, type PublicationContext } from "@/lib/presentation/snapshot-schema";
import type { PresentationSnapshotInput } from "@/lib/presentation/types";

export type PublicProposalResult =
  | { state: "not_found" }
  | { state: "unavailable" }
  | {
      state: "available";
      title: string;
      publicationId: string;
      versionNumber: number;
      publishedAt: Date;
      snapshot: PresentationSnapshotInput;
      context: PublicationContext;
      response: {
        action: "ACCEPT" | "REQUEST_CHANGES" | "REJECT";
        respondentName: string;
        respondedAt: Date;
        message: string | null;
      } | null;
    };

export const PublicProposalService = {
  async loadByToken(db: NodePgDatabase<typeof schema>, token: string): Promise<PublicProposalResult> {
    if (!isPublicTokenFormat(token)) return { state: "not_found" };
    const proposal = await ProposalsRepository.findByPublicToken(db, token);
    if (!proposal) return { state: "not_found" };
    if (!PUBLIC_PROPOSAL_STATUSES.includes(proposal.status as ProposalStatus)) return { state: "unavailable" };

    const organizationId = proposal.organizationId;
    return runInTenantContext(db, organizationId, async (tx) => {
      const publication = await ProposalPublicationsRepository.findLatestWithTx(tx, organizationId, proposal.id);
      if (!publication) return { state: "unavailable" } as const;
      const version = await ProposalVersionsRepository.findByIdWithTx(tx, organizationId, publication.versionId);
      if (!version) throw new Error(`Publication ${publication.id} points to a missing version`);
      const response = await ProposalResponsesRepository.findByPublicationWithTx(tx, organizationId, publication.id);

      // Throws on corrupted stored data: a server error, never a half-rendered page.
      const snapshot = parsePresentationSnapshot(version.snapshotJson);
      const context = parsePublicationContext(publication.context);

      return {
        state: "available" as const,
        title: snapshot.proposal.title,
        publicationId: publication.id,
        versionNumber: publication.versionNumber,
        publishedAt: publication.publishedAt,
        snapshot,
        context,
        response: response
          ? {
              action: response.action,
              respondentName: response.respondentName,
              respondedAt: response.respondedAt,
              message: response.message,
            }
          : null,
      };
    });
  },
};
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/services/proposal-response.service.test.ts src/services/public-proposal.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/services
git commit -m "feat: record client responses and load public proposals by token"
```

---

### Task 6: Creator API, PATCH status rule and hooks

**Files:**
- Modify: `src/services/proposal.service.ts`, `src/app/api/proposals/[id]/route.ts`, `src/app/api/proposals/[id]/route.test.ts`, `src/hooks/use-proposal.ts`, `src/hooks/use-proposal-items.ts`, `src/hooks/use-proposal-blocks.ts`
- Create: `src/app/api/proposals/[id]/publications/route.ts`, `src/app/api/proposals/[id]/send-state/route.ts`, `src/hooks/use-proposal-sending.ts`
- Test: `src/services/proposal.service.test.ts` (extend), `src/app/api/proposals/[id]/publications/route.test.ts`, `src/app/api/proposals/[id]/send-state/route.test.ts`, `src/hooks/use-proposal-sending.test.tsx`

**Interfaces:**
- Consumes: `ProposalSendingService` (Task 4), errors, `importRouteWithSession`/`ownerSession`, `seedProposal`.
- Produces: `ProposalService.update` rejects `status: "DRAFT"` unless the current status is `ARCHIVED` (`ProposalStatusTransitionError`); `PATCH` maps it to `409`.
- Produces (HTTP): `POST /api/proposals/[id]/publications` → `201 { publication, publicPath, created: true }` | `200 {…, created: false }` | `409 { error, code: "PROPOSAL_ARCHIVED" }` | `404` | `401`; `GET /api/proposals/[id]/publications` → `200 PublicationHistoryItem[]` | `404`; `GET /api/proposals/[id]/send-state` → `200 SendState` | `404` (dates as ISO strings).
- Produces (`src/hooks/use-proposal-sending.ts`): `proposalSendStateQueryKey(proposalId)` → `["proposal-send-state", proposalId]`; `proposalPublicationsQueryKey(proposalId)` → `["proposal-publications", proposalId]`; `interface SendStateDto` / `PublicationHistoryItemDto` (same fields as the service types with dates as `string`); `useProposalSendState(proposalId)`, `useProposalPublications(proposalId)`, `usePublishProposal(proposalId)` (mutation, no input; on success invalidates send-state, publications, `proposalQueryKey(proposalId)`, `["proposals"]` and `["opportunities"]`; on error `toast.error("Não foi possível enviar a proposta. Tente novamente.")`).
- Every existing proposal-content mutation (`useUpdateProposal`, `useAddProposalItem`, `useUpdateProposalItem`, `useRemoveProposalItem`, `useUpdateProposalBlock`) additionally invalidates `proposalSendStateQueryKey(proposalId)` on success.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/proposal.service.test.ts`:

```typescript
describe("ProposalService.update status rules", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("allows DRAFT only when unarchiving", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    await expect(
      ProposalService.update(db, organization.id, proposal.id, { status: "DRAFT", userId: owner.id }),
    ).rejects.toBeInstanceOf(ProposalStatusTransitionError);

    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    const unarchived = await ProposalService.update(db, organization.id, proposal.id, { status: "DRAFT", userId: owner.id });
    expect(unarchived.status).toBe("DRAFT");
  });
});
```

(add imports: `seedProposal` from `@/test/helpers/proposal-fixtures`, `ProposalSendingService` from `./proposal-sending.service`, `ProposalStatusTransitionError` from `@/domain/proposals/errors`.)

Add to `src/app/api/proposals/[id]/route.test.ts` a PATCH test: after `ProposalSendingService.publish`, `PATCH { status: "DRAFT" }` returns `409`.

```typescript
// src/app/api/proposals/[id]/publications/route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalService } from "@/services/proposal.service";

const post = (id: string) => new Request(`http://localhost/api/proposals/${id}/publications`, { method: "POST" });
const get = (id: string) => new Request(`http://localhost/api/proposals/${id}/publications`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/proposals/:id/publications", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("POST publishes (201), repeats idempotently (200) and GET lists the history", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { POST, GET } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const first = await POST(post(proposal.id), params(proposal.id));
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(body.created).toBe(true);
    expect(body.publicPath).toMatch(/^\/p\//);

    const again = await POST(post(proposal.id), params(proposal.id));
    expect(again.status).toBe(200);
    expect((await again.json()).created).toBe(false);

    const history = await GET(get(proposal.id), params(proposal.id));
    expect(history.status).toBe(200);
    expect(await history.json()).toHaveLength(1);
  });

  it("POST 409 PROPOSAL_ARCHIVED for an archived proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await POST(post(proposal.id), params(proposal.id));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PROPOSAL_ARCHIVED");
  });

  it("404 for another organization's proposal and 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    const asB = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(b.organization.id, b.owner.id) });
    expect((await asB.POST(post(a.proposal.id), params(a.proposal.id))).status).toBe(404);
    expect((await asB.GET(get(a.proposal.id), params(a.proposal.id))).status).toBe(404);

    const anonymous = await importRouteWithSession(() => import("./route"), { db, session: null });
    expect((await anonymous.POST(post(a.proposal.id), params(a.proposal.id))).status).toBe(401);
    expect((await anonymous.GET(get(a.proposal.id), params(a.proposal.id))).status).toBe(401);
  });
});
```

```typescript
// src/app/api/proposals/[id]/send-state/route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";

const get = (id: string) => new Request(`http://localhost/api/proposals/${id}/send-state`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/proposals/:id/send-state", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns the computed state", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await GET(get(proposal.id), params(proposal.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "DRAFT",
      publicPath: null,
      latestPublication: null,
      latestVersionNumber: 1,
      hasUnsentChanges: true,
      canSend: true,
    });
  });

  it("404 for another organization and 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    const asB = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(b.organization.id, b.owner.id) });
    expect((await asB.GET(get(a.proposal.id), params(a.proposal.id))).status).toBe(404);
    const anonymous = await importRouteWithSession(() => import("./route"), { db, session: null });
    expect((await anonymous.GET(get(a.proposal.id), params(a.proposal.id))).status).toBe(401);
  });
});
```

```tsx
// src/hooks/use-proposal-sending.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { proposalSendStateQueryKey, usePublishProposal, useProposalSendState } from "./use-proposal-sending";
import { useUpdateProposal } from "./use-proposal";

function wrapperWith(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("proposal sending hooks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads send-state from the API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "DRAFT", publicPath: null, latestPublication: null, latestVersionNumber: 1, hasUnsentChanges: true, canSend: true })),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useProposalSendState("p1"), { wrapper: wrapperWith(client) });
    await waitFor(() => expect(result.current.data?.canSend).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/proposals/p1/send-state", undefined);
  });

  it("publishes with POST and no body, then invalidates send-state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ publication: { id: "pub1" }, publicPath: "/p/x", created: true }), { status: 201 }),
    );
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => usePublishProposal("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/proposals/p1/publications", { method: "POST" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalSendStateQueryKey("p1") });
  });

  it("content mutations invalidate send-state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "p1", title: "T" })));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateProposal("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate({ title: "T" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalSendStateQueryKey("p1") });
  });
});
```

(Read `src/lib/api-client.ts`: `apiFetch(url)` calls `fetch(url, init)`; with no init the second argument is `undefined` — adjust the first assertion to how `apiFetch` actually calls `fetch` and note it.)

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/services/proposal.service.test.ts "src/app/api/proposals/[id]" src/hooks/use-proposal-sending.test.tsx`
Expected: FAIL.

- [ ] **Step 3: PATCH status rule** — in `ProposalService.update`, right after reading `before` (and before updating):

```typescript
      if (input.status === "DRAFT" && before && before.status !== "ARCHIVED" && before.status !== "DRAFT") {
        throw new ProposalStatusTransitionError(before.status, "DRAFT");
      }
```

(`DRAFT → DRAFT` stays a harmless no-op.) In `src/app/api/proposals/[id]/route.ts` PATCH catch: `if (error instanceof ProposalStatusTransitionError) return NextResponse.json({ error: error.message }, { status: 409 });`.

- [ ] **Step 4: Routes**

```typescript
// src/app/api/proposals/[id]/publications/route.ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { ProposalSendingService } from "@/services/proposal-sending.service";
import { ProposalArchivedError, ProposalNotFoundError, UserNotOrganizationMemberError } from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  try {
    const result = await ProposalSendingService.publish(db, session.organizationId, id, session.userId);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ProposalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ProposalArchivedError) {
      return NextResponse.json({ error: error.message, code: "PROPOSAL_ARCHIVED" }, { status: 409 });
    }
    if (error instanceof UserNotOrganizationMemberError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const history = await ProposalSendingService.listPublications(db, session.organizationId, id);
  if (!history) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }
  return NextResponse.json(history, { status: 200 });
}
```

```typescript
// src/app/api/proposals/[id]/send-state/route.ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { ProposalSendingService } from "@/services/proposal-sending.service";
import { ProposalNotFoundError } from "@/domain/proposals/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const state = await ProposalSendingService.getSendState(db, session.organizationId, id);
  if (!state) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }
  return NextResponse.json(state, { status: 200 });
}
```

(If a malformed id makes Postgres throw 22P02, return 404 — check how `src/app/api/proposals/[id]/route.ts` GET handles malformed ids and do the same.)

- [ ] **Step 5: Hooks**

```typescript
// src/hooks/use-proposal-sending.ts
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { ProposalStatus } from "@/lib/proposal-themes";
import { proposalQueryKey } from "./use-proposal";

export interface SendStateResponseDto {
  action: "ACCEPT" | "REQUEST_CHANGES" | "REJECT";
  respondentName: string;
  respondentEmail: string;
  message: string | null;
  respondedAt: string;
}

export interface SendStateDto {
  status: ProposalStatus;
  publicPath: string | null;
  latestPublication: { id: string; versionNumber: number; publishedAt: string; response: SendStateResponseDto | null } | null;
  latestVersionNumber: number;
  hasUnsentChanges: boolean;
  canSend: boolean;
}

export interface PublicationHistoryItemDto {
  id: string;
  publicationNumber: number;
  versionNumber: number;
  publishedAt: string;
  response: SendStateResponseDto | null;
}

export interface PublishResultDto {
  publication: { id: string; versionNumber: number };
  publicPath: string;
  created: boolean;
}

export function proposalSendStateQueryKey(proposalId: string) {
  return ["proposal-send-state", proposalId] as const;
}

export function proposalPublicationsQueryKey(proposalId: string) {
  return ["proposal-publications", proposalId] as const;
}

export function useProposalSendState(proposalId: string): UseQueryResult<SendStateDto> {
  return useQuery({
    queryKey: proposalSendStateQueryKey(proposalId),
    queryFn: () => apiFetch<SendStateDto>(`/api/proposals/${proposalId}/send-state`),
  });
}

export function useProposalPublications(proposalId: string): UseQueryResult<PublicationHistoryItemDto[]> {
  return useQuery({
    queryKey: proposalPublicationsQueryKey(proposalId),
    queryFn: () => apiFetch<PublicationHistoryItemDto[]>(`/api/proposals/${proposalId}/publications`),
  });
}

export function usePublishProposal(proposalId: string): UseMutationResult<PublishResultDto, ApiError, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<PublishResultDto>(`/api/proposals/${proposalId}/publications`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: proposalSendStateQueryKey(proposalId) });
      queryClient.invalidateQueries({ queryKey: proposalPublicationsQueryKey(proposalId) });
      queryClient.invalidateQueries({ queryKey: proposalQueryKey(proposalId) });
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    },
    onError: () => {
      toast.error("Não foi possível enviar a proposta. Tente novamente.");
    },
  });
}
```

In `useUpdateProposal`, `useAddProposalItem`, `useUpdateProposalItem`, `useRemoveProposalItem` and `useUpdateProposalBlock`, add to each existing `onSuccess` (keep what's there):

```typescript
      queryClient.invalidateQueries({ queryKey: proposalSendStateQueryKey(proposalId) });
```

(import `proposalSendStateQueryKey` from `./use-proposal-sending`; if that creates a circular import with `use-proposal.ts`, move the two query-key builders into `src/hooks/proposal-sending-keys.ts` and import from there in both.)

- [ ] **Step 6: Run the tests to see them pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/services/proposal.service.test.ts "src/app/api/proposals/[id]" src/hooks`
Expected: PASS.

- [ ] **Step 7: Full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/services src/app/api/proposals src/hooks
git commit -m "feat: add creator sending API, send-state and hooks"
```

---

### Task 7: Public page and public response API

**Files:**
- Modify: `src/lib/auth/public-paths.ts`, `src/lib/auth/public-paths.test.ts`, `next.config.ts`
- Create: `src/app/(public)/layout.tsx`, `src/app/(public)/p/[token]/page.tsx`, `src/app/api/public/proposals/[token]/responses/route.ts`, `src/components/presentation/public-proposal-view.tsx`, `src/components/presentation/response-dialog.tsx`
- Test: `src/app/api/public/proposals/[token]/responses/route.test.ts`, `src/components/presentation/public-proposal-view.test.tsx`

**Interfaces:**
- Consumes: `PublicProposalService.loadByToken`, `ProposalResponseService.respond` (Task 5), `buildPresentation`, `presentResponse` (Task 2), `PresentationRenderer` with `response`/`onAction`, `presentationFontVariables` (V1 `fonts.ts`), `formatIssuedAt`.
- Produces: page `/p/[token]` (public), `POST /api/public/proposals/[token]/responses` (public).
- Produces: `PublicProposalView(props: { token: string; model: PresentationModel; publicationId: string; versionNumber: number; publishedAtLabel: string; response: PresentationResponse | null })` (Client Component).

- [ ] **Step 1: Write the failing tests**

In `src/lib/auth/public-paths.test.ts` add `"/p/abc"` and `"/p"` to the public cases and `"/pipeline"` / `"/proposals/x"` stay protected (read the file; `/pipeline` must not match `/p`).

```typescript
// src/app/api/public/proposals/[token]/responses/route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalService } from "@/services/proposal.service";
import { ProposalSendingService } from "@/services/proposal-sending.service";

function request(token: string, body: unknown) {
  return new Request(`http://localhost/api/public/proposals/${token}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (token: string) => ({ params: Promise.resolve({ token }) });

describe("POST /api/public/proposals/:token/responses (no session)", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function published() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    const sent = await ProposalSendingService.publish(db, seeded.organization.id, seeded.proposal.id, seeded.owner.id);
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: null });
    return { db, ...seeded, sent, token: sent.publicPath.replace("/p/", ""), POST };
  }

  it("201 records the response, with Cache-Control: no-store", async () => {
    const { POST, token, sent } = await published();
    const response = await POST(
      request(token, { publicationId: sent.publication.id, action: "ACCEPT", name: " Maria ", email: "maria@bella.test" }),
      params(token),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).response.respondentName).toBe("Maria");
  });

  it("400 for invalid input, including a missing message when requesting changes", async () => {
    const { POST, token, sent } = await published();
    const base = { publicationId: sent.publication.id, name: "Maria", email: "maria@bella.test" };

    for (const body of [
      { ...base, action: "REQUEST_CHANGES" },
      { ...base, action: "REQUEST_CHANGES", message: "   " },
      { ...base, action: "ACCEPT", email: "nao-e-email" },
      { ...base, action: "ACCEPT", name: "" },
      { ...base, action: "MAYBE" },
      { ...base, action: "ACCEPT", publicationId: "x" },
    ]) {
      const response = await POST(request(token, body), params(token));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("404 unknown token, 410 unavailable, 409 SUPERSEDED and 409 ALREADY_RESPONDED", async () => {
    const { db, POST, token, sent, organization, owner, proposal } = await published();
    const accept = { publicationId: sent.publication.id, action: "ACCEPT", name: "Maria", email: "maria@bella.test" };

    expect((await POST(request("Z".repeat(43), accept), params("Z".repeat(43)))).status).toBe(404);

    const superseded = await POST(request(token, { ...accept, publicationId: "00000000-0000-4000-8000-000000000000" }), params(token));
    expect(superseded.status).toBe(409);
    expect((await superseded.json()).code).toBe("SUPERSEDED");

    expect((await POST(request(token, accept), params(token))).status).toBe(201);
    const twice = await POST(request(token, accept), params(token));
    expect(twice.status).toBe(409);
    expect((await twice.json()).code).toBe("ALREADY_RESPONDED");

    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    expect((await POST(request(token, accept), params(token))).status).toBe(410);
  });
});
```

```tsx
// src/components/presentation/public-proposal-view.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PresentationModel } from "@/lib/presentation/types";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { PublicProposalView } from "./public-proposal-view";

const model: PresentationModel = {
  theme: "MINIMAL",
  title: "Campanha",
  headline: "Verão com Bella",
  body: null,
  creator: { name: "Thais", handle: "@thais" },
  clientName: "Bella Cosméticos",
  items: [],
  totalCents: 0,
  totalLabel: "R$ 0,00",
  issuedAtLabel: "25 de setembro de 2026",
};

function renderView(overrides: Partial<React.ComponentProps<typeof PublicProposalView>> = {}) {
  return render(
    <PublicProposalView
      token={"t".repeat(43)}
      model={model}
      publicationId="pub1"
      versionNumber={3}
      publishedAtLabel="25 de setembro de 2026"
      response={null}
      {...overrides}
    />,
  );
}

describe("PublicProposalView", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("accepting asks for name and e-mail, posts the response and refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ response: {} }), { status: 201 }));
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    expect(screen.getByText("Você está aceitando a versão 3 desta proposta, enviada em 25 de setembro de 2026.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nome"), "Maria");
    await userEvent.type(screen.getByLabelText("E-mail"), "maria@bella.test");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(fetchMock).toHaveBeenCalledWith(`/api/public/proposals/${"t".repeat(43)}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicationId: "pub1", action: "ACCEPT", name: "Maria", email: "maria@bella.test", message: null }),
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("requesting changes requires a message", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Pedir ajustes" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Maria");
    await userEvent.type(screen.getByLabelText("E-mail"), "maria@bella.test");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(screen.getByText("Descreva os ajustes que você gostaria.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejecting has an optional reason", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "Recusar" }));
    expect(screen.getByLabelText("Motivo (opcional)")).toBeInTheDocument();
  });

  it("SUPERSEDED shows the update message with a reload button", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "x", code: "SUPERSEDED" }), { status: 409 }),
    );
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Maria");
    await userEvent.type(screen.getByLabelText("E-mail"), "maria@bella.test");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Esta proposta foi atualizada. Recarregue para ver a versão atual.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("ALREADY_RESPONDED refreshes to show the recorded response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "x", code: "ALREADY_RESPONDED" }), { status: 409 }),
    );
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Recusar" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Maria");
    await userEvent.type(screen.getByLabelText("E-mail"), "maria@bella.test");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("with a response shows the result and no buttons", () => {
    renderView({ response: { action: "ACCEPT", respondentName: "Maria", respondedAtLabel: "26 de setembro de 2026", message: null } });
    expect(screen.queryByRole("button", { name: "Aceitar" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Proposta aceita por Maria em 26 de setembro de 2026.");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/auth/public-paths.test.ts src/app/api/public src/components/presentation/public-proposal-view.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Public path + headers**

In `src/lib/auth/public-paths.ts`: `const PUBLIC_PREFIXES = ["/login", "/sem-acesso", "/auth", "/p"];` (the existing `prefix === path || startsWith(prefix + "/")` rule keeps `/pipeline` and `/proposals` protected).

`next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Public proposal pages change when the client answers and carry a secret
  // token in the URL: no intermediate cache may store them.
  async headers() {
    return [{ source: "/p/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] }];
  },
};

export default nextConfig;
```

- [ ] **Step 4: Public API route**

```typescript
// src/app/api/public/proposals/[token]/responses/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ProposalResponseService } from "@/services/proposal-response.service";
import {
  ProposalUnavailableError,
  PublicProposalNotFoundError,
  PublicationAlreadyRespondedError,
  PublicationSupersededError,
} from "@/domain/proposals/errors";

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z
  .object({
    publicationId: z.uuid(),
    action: z.enum(["ACCEPT", "REQUEST_CHANGES", "REJECT"]),
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    message: z.string().trim().max(2000).nullish(),
  })
  .refine((body) => body.action !== "REQUEST_CHANGES" || !!body.message, {
    path: ["message"],
    message: "Descreva os ajustes que você gostaria.",
  });

// Public: no session. Everything resolves through token → proposal → publication.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400, headers: NO_STORE });
  }

  try {
    const response = await ProposalResponseService.respond(db, token, {
      publicationId: parsed.data.publicationId,
      action: parsed.data.action,
      name: parsed.data.name,
      email: parsed.data.email,
      message: parsed.data.message || null,
    });
    return NextResponse.json({ response }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof PublicProposalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404, headers: NO_STORE });
    }
    if (error instanceof ProposalUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 410, headers: NO_STORE });
    }
    if (error instanceof PublicationSupersededError || error instanceof PublicationAlreadyRespondedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409, headers: NO_STORE });
    }
    throw error;
  }
}
```

(zod 4: `z.uuid()`, `z.email()`, `z.flattenError()` exist; if the installed version differs, use `z.string().uuid()`, `z.string().email()`, `parsed.error.flatten()` and note it.)

- [ ] **Step 5: Response dialog and public view**

```tsx
// src/components/presentation/response-dialog.tsx
"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PresentationAction } from "@/lib/presentation/types";

const COPY: Record<PresentationAction, { title: string; messageLabel: string | null; messageRequired: boolean }> = {
  accept: { title: "Aceitar proposta", messageLabel: null, messageRequired: false },
  request_changes: { title: "Pedir ajustes", messageLabel: "Mensagem", messageRequired: true },
  reject: { title: "Recusar proposta", messageLabel: "Motivo (opcional)", messageRequired: false },
};

export interface ResponseDialogValues {
  name: string;
  email: string;
  message: string | null;
}

export function ResponseDialog({
  action,
  versionNumber,
  publishedAtLabel,
  pending,
  serverError,
  onSubmit,
  onReload,
  onOpenChange,
}: {
  action: PresentationAction | null;
  versionNumber: number;
  publishedAtLabel: string;
  pending: boolean;
  serverError: { message: string; reload: boolean } | null;
  onSubmit: (values: ResponseDialogValues) => void;
  onReload: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const copy = action ? COPY[action] : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError("Informe nome e e-mail.");
      return;
    }
    if (copy?.messageRequired && !message.trim()) {
      setError("Descreva os ajustes que você gostaria.");
      return;
    }
    setError(null);
    onSubmit({ name: name.trim(), email: email.trim(), message: message.trim() || null });
  }

  return (
    <Dialog open={action !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          {action === "accept" ? (
            <DialogDescription>
              Você está aceitando a versão {versionNumber} desta proposta, enviada em {publishedAtLabel}.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Nome
            <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            E-mail
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          {copy?.messageLabel ? (
            <label className="flex flex-col gap-1 text-sm">
              {copy.messageLabel}
              <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={2000} />
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          ) : null}
          {serverError ? (
            <div role="alert" className="flex flex-col gap-2 text-sm text-error">
              <p>{serverError.message}</p>
              {serverError.reload ? (
                <Button type="button" variant="outline" size="sm" onClick={onReload}>
                  Recarregar
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" disabled={pending}>
            Confirmar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// src/components/presentation/public-proposal-view.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { PresentationAction, PresentationModel, PresentationResponse } from "@/lib/presentation/types";
import { PresentationRenderer } from "./presentation-renderer";
import { ResponseDialog, type ResponseDialogValues } from "./response-dialog";

const API_ACTION: Record<PresentationAction, "ACCEPT" | "REQUEST_CHANGES" | "REJECT"> = {
  accept: "ACCEPT",
  request_changes: "REQUEST_CHANGES",
  reject: "REJECT",
};

export interface PublicProposalViewProps {
  token: string;
  model: PresentationModel;
  publicationId: string;
  versionNumber: number;
  publishedAtLabel: string;
  response: PresentationResponse | null;
}

/** Client wrapper for the public page: wires the renderer's actions to the response dialog. */
export function PublicProposalView({ token, model, publicationId, versionNumber, publishedAtLabel, response }: PublicProposalViewProps) {
  const router = useRouter();
  const [action, setAction] = React.useState<PresentationAction | null>(null);
  const [pending, setPending] = React.useState(false);
  const [serverError, setServerError] = React.useState<{ message: string; reload: boolean } | null>(null);

  async function submit(values: ResponseDialogValues) {
    if (!action) return;
    setPending(true);
    setServerError(null);
    try {
      const result = await fetch(`/api/public/proposals/${token}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicationId, action: API_ACTION[action], ...values }),
      });
      if (result.ok) {
        setAction(null);
        router.refresh();
        return;
      }
      const body = (await result.json().catch(() => ({}))) as { code?: string };
      if (result.status === 409 && body.code === "ALREADY_RESPONDED") {
        setAction(null);
        router.refresh();
      } else if (result.status === 409) {
        setServerError({ message: "Esta proposta foi atualizada. Recarregue para ver a versão atual.", reload: true });
      } else if (result.status === 410 || result.status === 404) {
        setServerError({ message: "Esta proposta não está mais disponível.", reload: true });
      } else if (result.status === 400) {
        setServerError({ message: "Confira os dados informados.", reload: false });
      } else {
        setServerError({ message: "Não foi possível registrar sua resposta. Tente novamente.", reload: false });
      }
    } catch {
      setServerError({ message: "Não foi possível registrar sua resposta. Tente novamente.", reload: false });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PresentationRenderer
        model={model}
        className="min-h-dvh"
        response={response ?? undefined}
        onAction={response ? undefined : (next) => {
          setServerError(null);
          setAction(next);
        }}
      />
      <ResponseDialog
        key={action ?? "closed"}
        action={action}
        versionNumber={versionNumber}
        publishedAtLabel={publishedAtLabel}
        pending={pending}
        serverError={serverError}
        onSubmit={submit}
        onReload={() => {
          setAction(null);
          router.refresh();
        }}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
      />
    </>
  );
}
```

- [ ] **Step 6: Layout and page**

```tsx
// src/app/(public)/layout.tsx
import { presentationFontVariables } from "@/components/presentation/fonts";

// Public surfaces (no session, no app shell). Only the theme fonts.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className={presentationFontVariables}>{children}</div>;
}
```

```tsx
// src/app/(public)/p/[token]/page.tsx
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { PublicProposalService } from "@/services/public-proposal.service";
import { buildPresentation } from "@/lib/presentation/build-presentation";
import { presentResponse } from "@/lib/presentation/present-response";
import { formatIssuedAt } from "@/lib/presentation/format";
import { PublicProposalView } from "@/components/presentation/public-proposal-view";

export const dynamic = "force-dynamic";

// One load per request, shared by generateMetadata and the page.
const load = cache((token: string) => PublicProposalService.loadByToken(db, token));

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const result = await load(token);
  return {
    title: result.state === "available" ? result.title : "PublyFlow",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await load(token);

  if (result.state === "not_found") notFound();
  if (result.state === "unavailable") {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">Esta proposta não está mais disponível.</p>
      </main>
    );
  }

  // The loader already normalized issuedAt to a Date: buildPresentation stays pure.
  const model = buildPresentation(result.snapshot, {
    creator: result.context.creator,
    client: { name: result.context.clientName },
    issuedAt: result.context.issuedAt,
  });

  return (
    <PublicProposalView
      token={token}
      model={model}
      publicationId={result.publicationId}
      versionNumber={result.versionNumber}
      publishedAtLabel={formatIssuedAt(result.publishedAt)}
      response={result.response ? presentResponse(result.response) : null}
    />
  );
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/auth/public-paths.test.ts src/app/api/public src/components/presentation`
Expected: PASS.

- [ ] **Step 8: Full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add next.config.ts src/lib/auth "src/app/(public)" src/app/api/public src/components/presentation
git commit -m "feat: add public proposal page and client response API"
```

The build must list `ƒ /p/[token]` and `ƒ /api/public/proposals/[token]/responses`.

---

### Task 8: Builder sending panel, history and badges

**Files:**
- Create: `src/components/proposals/proposal-status-badge.tsx`, `src/components/proposals/proposal-send-panel.tsx`, `src/components/proposals/proposal-send-history.tsx`
- Modify: `src/app/(app)/proposals/[id]/page.tsx`, `src/app/(app)/proposals/[id]/page.test.tsx`, `src/components/pipeline/opportunity-side-panel.tsx`, `src/lib/presentation/format.ts` (uses `formatDateTime` from Task 2)
- Test: `src/components/proposals/proposal-send-panel.test.tsx`, `src/components/proposals/proposal-send-history.test.tsx`, `src/components/proposals/proposal-status-badge.test.tsx`

**Interfaces:**
- Consumes: `useProposalSendState`, `usePublishProposal`, `useProposalPublications`, `SendStateDto` (Task 6); `PROPOSAL_STATUS_LABELS`, `PROPOSAL_STATUS_BADGE_VARIANT` (Task 1); `formatDateTime`, `formatIssuedAt`; `Badge`, `Button`, `Dialog*`, `AlertDialog*`, `Input`; `toast`.
- Produces: `ProposalStatusBadge({ status })`, `ProposalSendPanel({ proposalId })`, `ProposalSendHistory({ proposalId })`.

Copy (exact):
- Panel sections: headings "Negociação" and "Documento".
- Negotiation: no publication → "Ainda não enviada."; publication without response → "Aguardando resposta · versão {N} enviada em {data}"; with response → the status badge + "{nome} · {email} · {data-hora}" + the message in a quote block (only for `REQUEST_CHANGES`/`REJECT` when present).
- Document: `hasUnsentChanges && latestPublication` → "Alterações não enviadas — o cliente ainda vê a versão {N}."; `status = DRAFT && latestPublication` → "O link está desativado até você reenviar."
- Send button: "Enviar proposta" when no publication, else "Reenviar". Disabled when `!canSend`; hint under it: `SENT` → "Nada mudou desde o envio"; `CHANGES_REQUESTED` → "Edite a proposta e reenvie".
- Confirmation (only `APPROVED`/`REJECTED`): title "Abrir nova rodada?", text "Esta proposta já foi aceita. Reenviar abre uma nova rodada e o status volta para Enviada." / "…já foi recusada…", buttons "Cancelar" / "Reenviar".
- Link actions (only with `publicPath`): "Copiar link" (toast "Link copiado.") and "Abrir" (new tab, `rel="noopener noreferrer"`).
- Post-send dialog: title "Proposta enviada", text "Envie este link ao cliente pelo canal que você já usa.", read-only input with the full URL (`window.location.origin + publicPath`), buttons "Copiar link" and "Abrir".
- History heading "Histórico de envios"; rows "Versão {N} · {data-hora} · {resultado}" where resultado is "aguardando", "ajustes: {mensagem}", "aceita por {nome}", "recusada por {nome}".
- `ARCHIVED` → panel renders nothing. Archive dialog in the builder gains the sentence "O link público deixará de funcionar."

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/proposals/proposal-send-panel.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SendStateDto } from "@/hooks/use-proposal-sending";

let sendState: SendStateDto | undefined;
const mutateMock = vi.fn();
vi.mock("@/hooks/use-proposal-sending", () => ({
  useProposalSendState: () => ({ data: sendState, isLoading: false }),
  usePublishProposal: () => ({ mutate: mutateMock, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProposalSendPanel } from "./proposal-send-panel";

const published = { id: "pub1", versionNumber: 3, publishedAt: "2026-09-25T17:32:00.000Z", response: null };
const accepted = {
  ...published,
  response: { action: "ACCEPT" as const, respondentName: "Maria", respondentEmail: "maria@bella.test", message: null, respondedAt: "2026-09-26T12:00:00.000Z" },
};
const changes = {
  ...published,
  response: { action: "REQUEST_CHANGES" as const, respondentName: "Maria", respondentEmail: "maria@bella.test", message: "Trocar stories", respondedAt: "2026-09-26T12:00:00.000Z" },
};

function state(overrides: Partial<SendStateDto>): SendStateDto {
  return { status: "DRAFT", publicPath: null, latestPublication: null, latestVersionNumber: 1, hasUnsentChanges: true, canSend: true, ...overrides };
}

describe("ProposalSendPanel", () => {
  beforeEach(() => {
    mutateMock.mockReset();
  });

  it("DRAFT never sent: 'Enviar proposta' and 'Ainda não enviada.'", async () => {
    sendState = state({});
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("Ainda não enviada.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enviar proposta" }));
    expect(mutateMock).toHaveBeenCalled();
  });

  it("SENT without changes: waiting, link actions, Reenviar disabled with hint", () => {
    sendState = state({ status: "SENT", publicPath: "/p/tok", latestPublication: published, latestVersionNumber: 3, hasUnsentChanges: false, canSend: false });
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText(/Aguardando resposta · versão 3 enviada em/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reenviar" })).toBeDisabled();
    expect(screen.getByText("Nada mudou desde o envio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", "/p/tok");
  });

  it("SENT with changes: document warning and Reenviar without confirmation", async () => {
    sendState = state({ status: "SENT", publicPath: "/p/tok", latestPublication: published, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("Alterações não enviadas — o cliente ainda vê a versão 3.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(mutateMock).toHaveBeenCalled();
  });

  it("CHANGES_REQUESTED: shows who asked and the message; without changes hints to edit", () => {
    sendState = state({ status: "CHANGES_REQUESTED", publicPath: "/p/tok", latestPublication: changes, latestVersionNumber: 3, hasUnsentChanges: false, canSend: false });
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("Ajustes pedidos")).toBeInTheDocument();
    expect(screen.getByText(/Maria · maria@bella.test ·/)).toBeInTheDocument();
    expect(screen.getByText("Trocar stories")).toBeInTheDocument();
    expect(screen.getByText("Edite a proposta e reenvie")).toBeInTheDocument();
  });

  it("CHANGES_REQUESTED with changes resends without confirmation", async () => {
    sendState = state({ status: "CHANGES_REQUESTED", publicPath: "/p/tok", latestPublication: changes, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);
    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(mutateMock).toHaveBeenCalled();
    expect(screen.queryByText("Abrir nova rodada?")).not.toBeInTheDocument();
  });

  it("APPROVED with changes: negotiation and document shown separately, resend asks for confirmation", async () => {
    sendState = state({ status: "APPROVED", publicPath: "/p/tok", latestPublication: accepted, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("Aceita")).toBeInTheDocument();
    expect(screen.getByText("Alterações não enviadas — o cliente ainda vê a versão 3.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(mutateMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Esta proposta já foi aceita. Reenviar abre uma nova rodada e o status volta para Enviada.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Reenviar" }));
    expect(mutateMock).toHaveBeenCalled();
  });

  it("REJECTED with changes asks for confirmation with the rejected copy", async () => {
    sendState = state({
      status: "REJECTED",
      publicPath: "/p/tok",
      latestPublication: { ...accepted, response: { ...accepted.response, action: "REJECT" } },
      latestVersionNumber: 4,
      hasUnsentChanges: true,
      canSend: true,
    });
    render(<ProposalSendPanel proposalId="p1" />);
    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(screen.getByText("Esta proposta já foi recusada. Reenviar abre uma nova rodada e o status volta para Enviada.")).toBeInTheDocument();
  });

  it("DRAFT after unarchiving: link disabled message and Reenviar", () => {
    sendState = state({ status: "DRAFT", publicPath: null, latestPublication: accepted, latestVersionNumber: 5, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("O link está desativado até você reenviar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reenviar" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Copiar link" })).not.toBeInTheDocument();
  });

  it("ARCHIVED renders nothing", () => {
    sendState = state({ status: "ARCHIVED", canSend: false });
    const { container } = render(<ProposalSendPanel proposalId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

```tsx
// src/components/proposals/proposal-send-history.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-proposal-sending", () => ({
  useProposalPublications: () => ({
    data: [
      { id: "b", publicationNumber: 2, versionNumber: 4, publishedAt: "2026-09-26T12:00:00.000Z", response: null },
      {
        id: "a",
        publicationNumber: 1,
        versionNumber: 3,
        publishedAt: "2026-09-25T17:32:00.000Z",
        response: { action: "REQUEST_CHANGES", respondentName: "Maria", respondentEmail: "m@x.test", message: "Trocar stories", respondedAt: "2026-09-25T20:00:00.000Z" },
      },
    ],
  }),
}));

import { ProposalSendHistory } from "./proposal-send-history";

describe("ProposalSendHistory", () => {
  it("lists every publication, latest first, with its result", () => {
    render(<ProposalSendHistory proposalId="p1" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Versão 4 · 26/09/2026, 09:00 · aguardando");
    expect(items[1]).toHaveTextContent("Versão 3 · 25/09/2026, 14:32 · ajustes: Trocar stories");
  });
});
```

```tsx
// src/components/proposals/proposal-status-badge.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProposalStatusBadge } from "./proposal-status-badge";

describe("ProposalStatusBadge", () => {
  it.each([
    ["SENT", "Enviada", "text-info"],
    ["APPROVED", "Aceita", "text-success"],
    ["REJECTED", "Recusada", "text-error"],
    ["CHANGES_REQUESTED", "Ajustes pedidos", "text-warning"],
  ] as const)("%s", (status, label, colorClass) => {
    render(<ProposalStatusBadge status={status} />);
    expect(screen.getByText(label).className).toContain(colorClass);
  });
});
```

Extend `src/app/(app)/proposals/[id]/page.test.tsx`: mock `@/components/proposals/proposal-send-panel` and `@/components/proposals/proposal-send-history` as stubs rendering `<div>send-panel</div>` / `<div>send-history</div>`, and assert both render and that the header shows the status badge text "Rascunho".

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/components/proposals "src/app/(app)/proposals"`
Expected: FAIL.

- [ ] **Step 3: Components**

```tsx
// src/components/proposals/proposal-status-badge.tsx
import { Badge } from "@/components/ui/badge";
import { PROPOSAL_STATUS_BADGE_VARIANT, PROPOSAL_STATUS_LABELS, type ProposalStatus } from "@/lib/proposal-themes";

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  return <Badge variant={PROPOSAL_STATUS_BADGE_VARIANT[status]}>{PROPOSAL_STATUS_LABELS[status]}</Badge>;
}
```

```tsx
// src/components/proposals/proposal-send-panel.tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { useProposalSendState, usePublishProposal, type SendStateDto } from "@/hooks/use-proposal-sending";
import { formatDateTime, formatIssuedAt } from "@/lib/presentation/format";
import { ProposalStatusBadge } from "./proposal-status-badge";

const DISABLED_HINT: Partial<Record<SendStateDto["status"], string>> = {
  SENT: "Nada mudou desde o envio",
  CHANGES_REQUESTED: "Edite a proposta e reenvie",
};

const CONFIRM_COPY: Partial<Record<SendStateDto["status"], string>> = {
  APPROVED: "Esta proposta já foi aceita. Reenviar abre uma nova rodada e o status volta para Enviada.",
  REJECTED: "Esta proposta já foi recusada. Reenviar abre uma nova rodada e o status volta para Enviada.",
};

function absoluteUrl(publicPath: string) {
  return typeof window === "undefined" ? publicPath : `${window.location.origin}${publicPath}`;
}

async function copyLink(publicPath: string) {
  try {
    await navigator.clipboard.writeText(absoluteUrl(publicPath));
    toast.success("Link copiado.");
  } catch {
    toast.error("Não foi possível copiar o link.");
  }
}

/** Renders only what GET /send-state computed; never derives state itself. */
export function ProposalSendPanel({ proposalId }: { proposalId: string }) {
  const { data: state } = useProposalSendState(proposalId);
  const publish = usePublishProposal(proposalId);
  const [confirming, setConfirming] = React.useState(false);
  const [sentPath, setSentPath] = React.useState<string | null>(null);

  if (!state || state.status === "ARCHIVED") return null;

  const publication = state.latestPublication;
  const response = publication?.response ?? null;

  function send() {
    publish.mutate(undefined, { onSuccess: (result) => setSentPath(result.publicPath) });
  }

  function onSendClick() {
    if (CONFIRM_COPY[state!.status]) {
      setConfirming(true);
    } else {
      send();
    }
  }

  return (
    <section aria-label="Envio" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Negociação</h2>
        {!publication ? (
          <p className="text-sm text-muted-foreground">Ainda não enviada.</p>
        ) : !response ? (
          <p className="text-sm text-muted-foreground">
            Aguardando resposta · versão {publication.versionNumber} enviada em {formatIssuedAt(new Date(publication.publishedAt))}
          </p>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <div>
              <ProposalStatusBadge status={state.status} />
            </div>
            <p className="text-muted-foreground">
              {response.respondentName} · {response.respondentEmail} · {formatDateTime(new Date(response.respondedAt))}
            </p>
            {response.message ? (
              <blockquote className="whitespace-pre-line border-l-2 border-border pl-3">{response.message}</blockquote>
            ) : null}
          </div>
        )}
      </div>

      {publication && (state.hasUnsentChanges || state.status === "DRAFT") ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Documento</h2>
          {state.status === "DRAFT" ? (
            <p role="status" className="text-sm text-warning">O link está desativado até você reenviar.</p>
          ) : (
            <p role="status" className="text-sm text-warning">
              Alterações não enviadas — o cliente ainda vê a versão {publication.versionNumber}.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={onSendClick} disabled={!state.canSend || publish.isPending}>
          {publication ? "Reenviar" : "Enviar proposta"}
        </Button>
        {state.publicPath ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => copyLink(state.publicPath!)}>
              Copiar link
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={state.publicPath} target="_blank" rel="noopener noreferrer">
                Abrir
              </a>
            </Button>
          </>
        ) : null}
      </div>
      {!state.canSend && DISABLED_HINT[state.status] ? (
        <p className="text-xs text-muted-foreground">{DISABLED_HINT[state.status]}</p>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abrir nova rodada?</AlertDialogTitle>
            <AlertDialogDescription>{CONFIRM_COPY[state.status]}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={() => {
                  setConfirming(false);
                  send();
                }}
              >
                Reenviar
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={sentPath !== null} onOpenChange={(open) => !open && setSentPath(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proposta enviada</DialogTitle>
            <DialogDescription>Envie este link ao cliente pelo canal que você já usa.</DialogDescription>
          </DialogHeader>
          {sentPath ? (
            <div className="flex flex-col gap-3">
              <Input readOnly value={absoluteUrl(sentPath)} aria-label="Link da proposta" onFocus={(event) => event.target.select()} />
              <div className="flex gap-2">
                <Button type="button" onClick={() => copyLink(sentPath)}>
                  Copiar link
                </Button>
                <Button asChild variant="outline">
                  <a href={sentPath} target="_blank" rel="noopener noreferrer">
                    Abrir
                  </a>
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
```

```tsx
// src/components/proposals/proposal-send-history.tsx
"use client";

import { useProposalPublications, type PublicationHistoryItemDto } from "@/hooks/use-proposal-sending";
import { formatDateTime } from "@/lib/presentation/format";

function resultLabel(item: PublicationHistoryItemDto): string {
  const response = item.response;
  if (!response) return "aguardando";
  if (response.action === "REQUEST_CHANGES") return `ajustes: ${response.message ?? ""}`.trim();
  if (response.action === "ACCEPT") return `aceita por ${response.respondentName}`;
  return `recusada por ${response.respondentName}`;
}

/** Immutable audit trail: every publication stays listed. */
export function ProposalSendHistory({ proposalId }: { proposalId: string }) {
  const { data } = useProposalPublications(proposalId);
  if (!data || data.length === 0) return null;

  return (
    <section aria-label="Histórico de envios" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Histórico de envios</h2>
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {data.map((item) => (
          <li key={item.id}>
            Versão {item.versionNumber} · {formatDateTime(new Date(item.publishedAt))} · {resultLabel(item)}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Builder and opportunity panel**

In `src/app/(app)/proposals/[id]/page.tsx`:
- Import `ProposalStatusBadge`, `ProposalSendPanel`, `ProposalSendHistory`.
- In the top row, next to "Voltar", render `<ProposalStatusBadge status={proposal.status} />` (wrap "Voltar" and the badge in `<div className="flex items-center gap-3">`).
- Right after the title/theme block, render:

```tsx
      <ProposalSendPanel proposalId={proposalId} />
      <ProposalSendHistory proposalId={proposalId} />
```

- In the archive `AlertDialogDescription`, append the sentence "O link público deixará de funcionar." (new line after the existing text).

In `src/components/pipeline/opportunity-side-panel.tsx`, replace `<Badge>{PROPOSAL_STATUS_LABELS[proposal.status]}</Badge>` with `<ProposalStatusBadge status={proposal.status} />` (remove now-unused imports).

- [ ] **Step 5: Run the tests to see them pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/components/proposals src/components/pipeline "src/app/(app)/proposals"`
Expected: PASS.

- [ ] **Step 6: Full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/components/proposals src/components/pipeline "src/app/(app)/proposals"
git commit -m "feat: add sending panel, history and status badges to the builder"
```

---

## Visual verification (controller, after Task 8, before the final review)

In the browser pane (dev server of the worktree, logged in by the user), desktop and phone width, run the spec's cycle and capture each step:

1. Create/send V1 from the builder (post-send dialog shows the link).
2. Open `/p/<token>` in a tab **without session** (fresh browser context or cookies cleared for that tab); confirm `curl -I` shows `Cache-Control: private, no-store` on the page.
3. Request changes (message required).
4. Builder: badge "Ajustes pedidos", negotiation card with name/e-mail/message; opportunity in `NEGOCIACAO`.
5. Edit (V2): "Alterações não enviadas — o cliente ainda vê a versão 1."
6. Resend (no confirmation).
7. In the tab still on V1, try to respond → "Esta proposta foi atualizada…" + Recarregar.
8. Reload the same link → V2.
9. Accept V2.
10. Builder: "Aceita"; opportunity `FECHADO`; history lists both rounds.
11. Archive (dialog mentions the link).
12. The same link shows "Esta proposta não está mais disponível."

## Self-Review

**Spec coverage:** §2 principles/invariants → Tasks 1 (immutability trigger, unique response), 4–5 (`expectProposalInvariants`, no-version assertions). §3.1 data → Task 1. §3.2 transitions + PATCH rule → Tasks 4, 5, 6. §3.3 pipeline (open only, history) → `moveOpportunityIfOpenWithTx` (Task 4), tests in 4 and 5. §3.4 concurrency (row lock; concurrent sends 201/200; concurrent responses) → Tasks 4, 5. §4.1 route/headers/no-store/robots/referrer → Task 7. §4.2 loader (token format, global lookup comment, unavailable without content, zod validation, frozen context, normalized `issuedAt`) → Tasks 2, 3, 5, 7. §4.3 renderer response + view + dialog → Tasks 2, 7. §4.4 public API (chain-only lookup, codes, no-store) → Tasks 5, 7. §5.1 send-state REPEATABLE READ + invalidation → Tasks 4, 6. §5.2 canSend table + confirmation as UX + publish algorithm → Tasks 4, 8. §5.3 creator API → Task 6. §5.4 builder panel/dialogs/history/badges/archive copy → Task 8. §6 tests → each task; visual cycle → controller section.

**Placeholder scan:** code is complete in every step; notes only cover verifying installed zod/Drizzle API names and test-harness details.

**Type consistency:** `ProposalStatus`/labels/variants/`PUBLIC_PROPOSAL_STATUSES` (1) used in 2, 4–8; `PresentationResponse`, `parsePresentationSnapshot`, `parsePublicationContext`, `toPublicationContextJson`, `presentResponse`, `formatDateTime`, sharing constants (2) used in 4, 5, 7, 8; repositories and `seedProposal` (3) used in 4–6; `ProposalSendingService`/`SendState`/`computeSendFlags` (4) used in 5, 6; `ProposalResponseService`/`PublicProposalService` (5) used in 7; hooks/DTOs (6) used in 8; error classes (4) used in 5–7.
