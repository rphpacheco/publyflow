# Communication Layer — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit domain events for proposal sending/responses in the same transaction as the fact, process them with a cron-backed worker into per-member in-app notifications (bell in the header), and let the creator share the proposal link through WhatsApp click-to-chat, e-mail (`mailto:`) or a copied message — with no channel API.

**Architecture:** A `domain_events` outbox is written by `ProposalSendingService.publish` (only when a publication is created) and `ProposalResponseService.respond`, inside their existing locked transactions. `EventDrainService.drain` claims pending events one at a time (`FOR UPDATE SKIP LOCKED`), runs the handler registered for the event type (idempotent), and marks it `done`, or schedules a retry with backoff / marks it `dead`. It is invoked by a Vercel Cron route and, for low latency, right after the response of the publish and public-response routes via Next's `after()`. The only handlers in this phase fan `proposal.approved|changes_requested|rejected` out into `notifications` (one row per organization member). Share links are pure functions over data served by a small share-info endpoint.

**Tech Stack:** Next.js 16 (route handlers, `after` from `next/server`, `vercel.json` crons), React 19, TanStack Query, Drizzle + Postgres (`FOR UPDATE SKIP LOCKED`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-25-communication-layer-design.md` — §4 (event log), §4.3 (worker), §10 Fase 0, §12 (recommendation). Only Phase 0 is in scope: **no** `channel_accounts`, templates, identities, conversation/message changes, or any Meta/Resend integration.

## Global Constraints

- **Read the Next.js 16 docs first:** `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` and the route-handler guide (AGENTS.md).
- **Event types:** `{entity}.{action}` snake_case, enforced by a DB `CHECK` (`^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`). Phase 0 types: `proposal.sent`, `proposal.approved`, `proposal.changes_requested`, `proposal.rejected`.
- **Atomicity:** events are written in the same transaction as the fact they describe. A rolled-back fact never leaves an event, and a committed fact always has its event. An idempotent publish (`created: false`) emits nothing.
- **Payload:** carries no e-mail or phone.
  - Allowed fields: ids, `version_number`, `proposal_title`, `respondent_name`.
  - `message_excerpt`/`reason_excerpt` are capped at 140 characters.
- **Drain processing:**
  - Handlers are idempotent.
  - Events without a handler are marked `done`.
  - Backoff after a failure: `next_attempt_at = now + min(2^attempts, 60) minutes`.
  - After the 5th failed attempt, status is `dead`.
- **Drain route:** `GET|POST /api/internal/events/drain` requires `Authorization: Bearer ${CRON_SECRET}`.
  - It is fail-closed: a missing `CRON_SECRET` returns 503; a missing or wrong token returns 401.
  - The proxy never sees it, because `/api` is excluded from the matcher.
- **Notifications:**
  - one row per organization member (`recipient_user_id not null`), unique `(source_event_id, recipient_user_id)`;
  - read state is per user;
  - the API returns only rows where `recipient_user_id = session.userId` and `organization_id = session.organizationId`.
- **Sharing:** nothing is recorded as "sent" — there is no delivery confirmation without a channel API. Phone normalization for `wa.me`:
  - keep digits only;
  - 10–11 digits → prefix `55`;
  - no phone → `https://wa.me/?text=…`, so the user picks the contact.
- **Copy:** Portuguese UI copy exactly as in this plan.
- **Database rule:** implementers never run migrations or write to a DB outside the Vitest suite; the controller applies migration 0018.
- **Commands:** use `/opt/homebrew/bin/pnpm`.
  - Full suite: `/opt/homebrew/bin/pnpm vitest run` (add `--testTimeout=60000 --hookTimeout=60000` under host load).
  - Build: `OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build`.
- **Commits:** end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema/domain-events.ts` | `domainEvents`, `notifications` tables |
| `src/db/migrations/0018_add_domain_events_and_notifications.sql` | generated DDL + RLS |
| `src/repositories/domain-events.repository.ts` | append, claim next, mark done/failed |
| `src/repositories/notifications.repository.ts` | fan-out insert, list for user, mark read |
| `src/lib/events/proposal-events.ts` | pure payload builders + event type constants |
| `src/services/event-drain.service.ts` | drain loop + handler registry |
| `src/services/event-handlers/proposal-notifications.ts` | `proposal.*` → notifications |
| `src/lib/events/schedule-drain.ts` | safe `after()` wrapper |
| `src/app/api/internal/events/drain/route.ts` | cron/kick endpoint |
| `vercel.json` | cron schedule |
| `src/app/api/notifications/...` | notifications API |
| `src/hooks/use-notifications.ts`, `src/components/shell/notifications-bell.tsx` | bell |
| `src/lib/share-links.ts` | pure share-link builders |
| `src/services/proposal-share.service.ts`, `src/app/api/proposals/[id]/share-info/route.ts`, `src/hooks/use-proposal-share-info.ts`, `src/components/proposals/proposal-share-actions.tsx` | share buttons |

---

### Task 1: Schema, migration 0018 and repositories

**Files:**
- Create: `src/db/schema/domain-events.ts`, `src/repositories/domain-events.repository.ts`, `src/repositories/notifications.repository.ts`
- Modify: `src/db/schema/index.ts` (export the new schema file — read how other schema files are exported), `src/test/helpers/db.ts` (`DOMAIN_TABLES`)
- Create (generated): `src/db/migrations/0018_add_domain_events_and_notifications.sql` + `meta/0018_snapshot.json` + journal entry
- Test: `src/repositories/domain-events.repository.test.ts`, `src/db/rls-domain-events.test.ts`

**Interfaces:**
- Produces:
  - Drizzle `domainEvents` table with columns `id, organizationId, eventType, entityType, entityId, payload, actor, occurredAt, status, attempts, nextAttemptAt, lastError, processedAt`.
  - Drizzle `notifications` table with columns `id, organizationId, recipientUserId, kind, title, body, linkPath, sourceEventId, readAt, createdAt`.
- Produces (`DomainEventsRepository`):
  - `appendWithTx(tx, organizationId, input: { eventType: string; entityType: string; entityId: string | null; payload: Record<string, unknown>; actor: Record<string, unknown> }): Promise<DomainEvent>`
  - `claimNextWithTx(tx, now: Date): Promise<DomainEvent | null>` — `status = 'pending'` and `next_attempt_at` null or `<= now`, ordered by `occurred_at`, `FOR UPDATE SKIP LOCKED`, limit 1.
  - `markDoneWithTx(tx, eventId, now: Date)`
  - `recordFailure(db, eventId, error: string, now: Date): Promise<DomainEvent>` — attempts + 1; `dead` when attempts reaches 5, otherwise `next_attempt_at = now + min(2^attempts, 60) minutes`; stores `last_error` truncated to 1000 chars.
  - `listForEntity(db, organizationId, entityType, entityId)` — for tests and debugging.
  - Type: `DomainEvent`.
- Produces (`NotificationsRepository`):
  - `fanOutWithTx(tx, organizationId, input: { sourceEventId: string; kind: string; title: string; body: string | null; linkPath: string | null }): Promise<number>` — one row per `organization_members` user, `ON CONFLICT (source_event_id, recipient_user_id) DO NOTHING`; returns the number of rows inserted.
  - `listForUser(db, organizationId, userId, limit: number): Promise<{ items: Notification[]; unreadCount: number }>` — latest first.
  - `markRead(db, organizationId, userId, notificationId, now: Date): Promise<boolean>` — false when the row is not the user's.
  - `markAllRead(db, organizationId, userId, now: Date): Promise<number>`
  - Type: `Notification`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/repositories/domain-events.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { DomainEventsRepository } from "./domain-events.repository";
import { NotificationsRepository } from "./notifications.repository";
import { organizationMembers, users } from "@/db/schema/organizations";

const append = (organizationId: string, entityId: string, eventType = "proposal.approved") => ({
  eventType,
  entityType: "proposal",
  entityId,
  payload: { proposal_title: "Campanha Verão" },
  actor: { kind: "client", name: "Maria" },
});

describe("DomainEventsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("appends, claims in order, skips future retries and marks done", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await seedProposal(db);

    const first = await db.transaction((tx) => DomainEventsRepository.appendWithTx(tx, organization.id, append(organization.id, proposal.id)));
    await db.transaction((tx) => DomainEventsRepository.appendWithTx(tx, organization.id, append(organization.id, proposal.id, "proposal.rejected")));
    expect(first.status).toBe("pending");

    const now = new Date();
    const claimed = await db.transaction(async (tx) => {
      const event = await DomainEventsRepository.claimNextWithTx(tx, now);
      await DomainEventsRepository.markDoneWithTx(tx, event!.id, now);
      return event;
    });
    expect(claimed?.id).toBe(first.id);

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    expect(events.map((event) => [event.eventType, event.status])).toEqual([
      ["proposal.approved", "done"],
      ["proposal.rejected", "pending"],
    ]);
  });

  it("rejects an invalid event type", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await seedProposal(db);
    await expect(
      db.transaction((tx) => DomainEventsRepository.appendWithTx(tx, organization.id, append(organization.id, proposal.id, "ProposalApproved"))),
    ).rejects.toThrow();
  });

  it("backs off on failure and goes dead after the 5th attempt", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await seedProposal(db);
    const event = await db.transaction((tx) => DomainEventsRepository.appendWithTx(tx, organization.id, append(organization.id, proposal.id)));
    const now = new Date("2026-09-26T12:00:00Z");

    const once = await DomainEventsRepository.recordFailure(db, event.id, "boom", now);
    expect(once).toMatchObject({ status: "pending", attempts: 1, lastError: "boom" });
    expect(once.nextAttemptAt?.toISOString()).toBe("2026-09-26T12:02:00.000Z");

    // not claimable before its next attempt
    const early = await db.transaction((tx) => DomainEventsRepository.claimNextWithTx(tx, now));
    expect(early).toBeNull();

    let last = once;
    for (let i = 0; i < 4; i += 1) last = await DomainEventsRepository.recordFailure(db, event.id, "boom", now);
    expect(last).toMatchObject({ status: "dead", attempts: 5 });
  });

  it("two concurrent claimers never take the same event", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await seedProposal(db);
    await db.transaction((tx) => DomainEventsRepository.appendWithTx(tx, organization.id, append(organization.id, proposal.id)));
    const now = new Date();

    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const firstClaim = db.transaction(async (tx) => {
      const event = await DomainEventsRepository.claimNextWithTx(tx, now);
      await hold;
      return event;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const secondClaim = await db.transaction((tx) => DomainEventsRepository.claimNextWithTx(tx, now));
    release();

    expect((await firstClaim)?.id).toBeDefined();
    expect(secondClaim).toBeNull();
  });
});

describe("NotificationsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("fans out once per member, idempotently, and reads per user", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const [manager] = await db.insert(users).values({ email: `m-${Date.now()}@publyflow.test`, fullName: "Gerente" }).returning();
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: manager.id, role: "MANAGER" });
    const event = await db.transaction((tx) => DomainEventsRepository.appendWithTx(tx, organization.id, append(organization.id, proposal.id)));

    const input = { sourceEventId: event.id, kind: "proposal.approved", title: "Proposta aceita", body: 'Maria aceitou "Campanha Verão".', linkPath: `/proposals/${proposal.id}` };
    expect(await db.transaction((tx) => NotificationsRepository.fanOutWithTx(tx, organization.id, input))).toBe(2);
    expect(await db.transaction((tx) => NotificationsRepository.fanOutWithTx(tx, organization.id, input))).toBe(0);

    const forOwner = await NotificationsRepository.listForUser(db, organization.id, owner.id, 20);
    expect(forOwner.unreadCount).toBe(1);
    expect(await NotificationsRepository.markRead(db, organization.id, owner.id, forOwner.items[0].id, new Date())).toBe(true);
    expect((await NotificationsRepository.listForUser(db, organization.id, owner.id, 20)).unreadCount).toBe(0);
    expect((await NotificationsRepository.listForUser(db, organization.id, manager.id, 20)).unreadCount).toBe(1);

    // another user's notification cannot be marked
    const forManager = await NotificationsRepository.listForUser(db, organization.id, manager.id, 20);
    expect(await NotificationsRepository.markRead(db, organization.id, owner.id, forManager.items[0].id, new Date())).toBe(false);
    expect(await NotificationsRepository.markAllRead(db, organization.id, manager.id, new Date())).toBe(1);
  });
});
```

```typescript
// src/db/rls-domain-events.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { domainEvents, notifications } from "./schema/domain-events";

describe("RLS on domain_events and notifications", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns rows of the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    for (const seeded of [a, b]) {
      const [event] = await db
        .insert(domainEvents)
        .values({ organizationId: seeded.organization.id, eventType: "proposal.sent", entityType: "proposal", entityId: seeded.proposal.id })
        .returning();
      await db.insert(notifications).values({
        organizationId: seeded.organization.id,
        recipientUserId: seeded.owner.id,
        kind: "proposal.sent",
        title: "x",
        sourceEventId: event.id,
      });
    }

    const visible = await getAppUserDb().transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${a.organization.id}, true)`);
      return { events: await tx.select().from(domainEvents), notes: await tx.select().from(notifications) };
    });
    expect(visible.events.map((row) => row.organizationId)).toEqual([a.organization.id]);
    expect(visible.notes.map((row) => row.organizationId)).toEqual([a.organization.id]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/repositories/domain-events.repository.test.ts src/db/rls-domain-events.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Schema**

```typescript
// src/db/schema/domain-events.ts
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./organizations";

/** Outbox of business facts, written in the same transaction as the fact. */
export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    payload: jsonb("payload").notNull().default({}),
    actor: jsonb("actor").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    check("domain_events_type_format", sql`${table.eventType} ~ '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$'`),
    check("domain_events_status_check", sql`${table.status} in ('pending','processing','done','dead')`),
    index("domain_events_pending_idx").on(table.nextAttemptAt, table.occurredAt).where(sql`${table.status} = 'pending'`),
    index("domain_events_entity_idx").on(table.entityType, table.entityId, table.occurredAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    linkPath: text("link_path"),
    sourceEventId: uuid("source_event_id").references(() => domainEvents.id, { onDelete: "set null" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("notifications_event_recipient_unique").on(table.sourceEventId, table.recipientUserId),
    index("notifications_recipient_idx").on(table.recipientUserId, table.createdAt),
  ],
);
```

(Check the installed Drizzle API for `check()` and partial `index().where()`; if the generated SQL escapes the regex differently, verify the resulting `CHECK` in the migration matches `'^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'` and adapt the TS escaping.) Export it from `src/db/schema/index.ts` the same way the other schema files are exported. Add `"notifications", "domain_events",` at the top of `DOMAIN_TABLES` in `src/test/helpers/db.ts`.

- [ ] **Step 4: Migration** — `/opt/homebrew/bin/pnpm drizzle-kit generate --name add_domain_events_and_notifications </dev/null` (must not prompt). Confirm the SQL creates only the two tables, their FKs, checks, unique and indexes. Append:

```sql

alter table domain_events enable row level security;

create policy org_isolation_domain_events on domain_events
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

alter table notifications enable row level security;

create policy org_isolation_notifications on notifications
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
```

- [ ] **Step 5: STOP** — report NEEDS_CONTEXT "migration 0018 generated with RLS, awaiting controller to apply". Don't commit. The controller applies it and resumes you.

- [ ] **Step 6: Repositories**

```typescript
// src/repositories/domain-events.repository.ts
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { domainEvents } from "@/db/schema/domain-events";

export type DomainEvent = typeof domainEvents.$inferSelect;

export const MAX_EVENT_ATTEMPTS = 5;

export interface AppendEventInput {
  eventType: string;
  entityType: string;
  entityId: string | null;
  payload: Record<string, unknown>;
  actor: Record<string, unknown>;
}

function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 60);
}

export const DomainEventsRepository = {
  /** Call inside the transaction that writes the fact. */
  async appendWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, input: AppendEventInput): Promise<DomainEvent> {
    const [event] = await tx.insert(domainEvents).values({ organizationId, ...input }).returning();
    return event;
  },

  /**
   * Global claim (the worker serves every organization). Like the public-token
   * lookup, this runs outside a tenant context; the RLS hardening subproject
   * must give the worker an explicit privileged path.
   */
  async claimNextWithTx(tx: NodePgDatabase<typeof schema>, now: Date): Promise<DomainEvent | null> {
    const [event] = await tx
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.status, "pending"), or(isNull(domainEvents.nextAttemptAt), lte(domainEvents.nextAttemptAt, now))))
      .orderBy(asc(domainEvents.occurredAt))
      .limit(1)
      .for("update", { skipLocked: true });
    return event ?? null;
  },

  async markDoneWithTx(tx: NodePgDatabase<typeof schema>, eventId: string, now: Date): Promise<void> {
    await tx.update(domainEvents).set({ status: "done", processedAt: now, lastError: null }).where(eq(domainEvents.id, eventId));
  },

  async recordFailure(db: NodePgDatabase<typeof schema>, eventId: string, error: string, now: Date): Promise<DomainEvent> {
    const [current] = await db.select().from(domainEvents).where(eq(domainEvents.id, eventId));
    const attempts = current.attempts + 1;
    const dead = attempts >= MAX_EVENT_ATTEMPTS;
    const [updated] = await db
      .update(domainEvents)
      .set({
        attempts,
        status: dead ? "dead" : "pending",
        lastError: error.slice(0, 1000),
        nextAttemptAt: dead ? null : new Date(now.getTime() + backoffMinutes(attempts) * 60_000),
      })
      .where(eq(domainEvents.id, eventId))
      .returning();
    return updated;
  },

  async listForEntity(db: NodePgDatabase<typeof schema>, organizationId: string, entityType: string, entityId: string): Promise<DomainEvent[]> {
    return db
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.organizationId, organizationId), eq(domainEvents.entityType, entityType), eq(domainEvents.entityId, entityId)))
      .orderBy(asc(domainEvents.occurredAt), sql`${domainEvents.id}`);
  },
};
```

(`listForEntity` orders by `occurred_at`; two events appended in separate transactions differ in `now()`. If the Drizzle version's `.for()` signature differs for `skipLocked`, use the documented equivalent and note it.)

```typescript
// src/repositories/notifications.repository.ts
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { notifications } from "@/db/schema/domain-events";
import { organizationMembers } from "@/db/schema/organizations";

export type Notification = typeof notifications.$inferSelect;

export interface FanOutInput {
  sourceEventId: string;
  kind: string;
  title: string;
  body: string | null;
  linkPath: string | null;
}

export const NotificationsRepository = {
  /** One row per organization member; replays insert nothing. */
  async fanOutWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, input: FanOutInput): Promise<number> {
    const members = await tx
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId));
    if (members.length === 0) return 0;
    const inserted = await tx
      .insert(notifications)
      .values(members.map((member) => ({ organizationId, recipientUserId: member.userId, ...input })))
      .onConflictDoNothing({ target: [notifications.sourceEventId, notifications.recipientUserId] })
      .returning({ id: notifications.id });
    return inserted.length;
  },

  async listForUser(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    userId: string,
    limit: number,
  ): Promise<{ items: Notification[]; unreadCount: number }> {
    const mine = and(eq(notifications.organizationId, organizationId), eq(notifications.recipientUserId, userId));
    const items = await db.select().from(notifications).where(mine).orderBy(desc(notifications.createdAt)).limit(limit);
    const [{ value }] = await db.select({ value: count() }).from(notifications).where(and(mine, isNull(notifications.readAt)));
    return { items, unreadCount: Number(value) };
  },

  async markRead(db: NodePgDatabase<typeof schema>, organizationId: string, userId: string, notificationId: string, now: Date): Promise<boolean> {
    const updated = await db
      .update(notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.organizationId, organizationId),
          eq(notifications.recipientUserId, userId),
        ),
      )
      .returning({ id: notifications.id });
    return updated.length > 0;
  },

  async markAllRead(db: NodePgDatabase<typeof schema>, organizationId: string, userId: string, now: Date): Promise<number> {
    const updated = await db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.organizationId, organizationId), eq(notifications.recipientUserId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return updated.length;
  },
};
```

(Existing repositories wrap reads in `runInTenantContext`; the notifications reads are always filtered explicitly by organization and user, matching how `ProposalsRepository.findByIdWithTx` filters. If lint/reviewers of this codebase expect `runInTenantContext` for public methods, wrap `listForUser`, `markRead`, `markAllRead` in it with the same queries.)

- [ ] **Step 7: Run the tests to see them pass**, then full suite, build, commit:

```bash
/opt/homebrew/bin/pnpm vitest run src/repositories/domain-events.repository.test.ts src/db/rls-domain-events.test.ts
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/db src/repositories src/test/helpers/db.ts
git commit -m "feat: add domain events outbox and notifications schema"
```

---

### Task 2: Emit events in publish and respond (same transaction)

**Files:**
- Create: `src/lib/events/proposal-events.ts`
- Modify: `src/services/proposal-sending.service.ts`, `src/services/proposal-response.service.ts`
- Test: `src/lib/events/proposal-events.test.ts`, `src/services/proposal-events-emission.test.ts`

**Interfaces:**
- Consumes: `DomainEventsRepository.appendWithTx`, `listForEntity` (Task 1); `seedProposal`; `ProposalSendingService`, `ProposalResponseService`.
- Produces (`src/lib/events/proposal-events.ts`, pure):
  ```typescript
  export const PROPOSAL_EVENT = {
    SENT: "proposal.sent",
    APPROVED: "proposal.approved",
    CHANGES_REQUESTED: "proposal.changes_requested",
    REJECTED: "proposal.rejected",
  } as const;
  export const RESPONSE_EVENT: Record<"ACCEPT" | "REQUEST_CHANGES" | "REJECT", string>;
  export function excerpt(text: string | null, max?: number): string | null; // trims, max 140 with "…"
  export function proposalSentEvent(input: { proposalId; proposalTitle; publicationId; versionNumber; opportunityId; userId }): AppendEventInput;
  export function proposalResponseEvent(input: { proposalId; proposalTitle; publicationId; versionNumber; opportunityId; action; respondentName; message: string | null }): AppendEventInput;
  ```
  Payload keys (snake_case): `proposal_id, proposal_title, publication_id, version_number, opportunity_id`, plus `respondent_name` and `message_excerpt` (REQUEST_CHANGES) / `reason_excerpt` (REJECT) for responses. `actor`: `{ kind: "user", user_id }` for sent; `{ kind: "client", name }` for responses. `entityType: "proposal"`, `entityId: proposalId`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/events/proposal-events.test.ts
import { describe, it, expect } from "vitest";
import { excerpt, proposalResponseEvent, proposalSentEvent } from "./proposal-events";

const base = { proposalId: "p1", proposalTitle: "Campanha", publicationId: "pub1", versionNumber: 2, opportunityId: "o1" };

describe("proposal event builders", () => {
  it("builds proposal.sent without PII", () => {
    expect(proposalSentEvent({ ...base, userId: "u1" })).toEqual({
      eventType: "proposal.sent",
      entityType: "proposal",
      entityId: "p1",
      payload: { proposal_id: "p1", proposal_title: "Campanha", publication_id: "pub1", version_number: 2, opportunity_id: "o1" },
      actor: { kind: "user", user_id: "u1" },
    });
  });

  it("maps each response to its event with an excerpt", () => {
    const changes = proposalResponseEvent({ ...base, action: "REQUEST_CHANGES", respondentName: "Maria", message: "Trocar stories" });
    expect(changes.eventType).toBe("proposal.changes_requested");
    expect(changes.payload).toMatchObject({ respondent_name: "Maria", message_excerpt: "Trocar stories" });
    expect(changes.actor).toEqual({ kind: "client", name: "Maria" });

    const rejected = proposalResponseEvent({ ...base, action: "REJECT", respondentName: "Maria", message: null });
    expect(rejected.eventType).toBe("proposal.rejected");
    expect(rejected.payload).toMatchObject({ reason_excerpt: null });

    const approved = proposalResponseEvent({ ...base, action: "ACCEPT", respondentName: "Maria", message: null });
    expect(approved.eventType).toBe("proposal.approved");
    expect(approved.payload).not.toHaveProperty("message_excerpt");
  });

  it("caps excerpts at 140 characters", () => {
    expect(excerpt("a".repeat(200))).toBe("a".repeat(139) + "…");
    expect(excerpt("  curto  ")).toBe("curto");
    expect(excerpt(null)).toBeNull();
  });
});
```

```typescript
// src/services/proposal-events-emission.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalService } from "./proposal.service";
import { ProposalSendingService } from "./proposal-sending.service";
import { ProposalResponseService } from "./proposal-response.service";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { ProposalsRepository } from "@/repositories/proposals.repository";

const tokenOf = (publicPath: string) => publicPath.replace("/p/", "");

describe("domain events emitted with the fact", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup?.();
  });

  it("publish emits proposal.sent once; an idempotent repeat emits nothing", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);

    const { publication } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "proposal.sent", status: "pending" });
    expect(events[0].payload).toMatchObject({ publication_id: publication.id, version_number: 1, proposal_title: "Campanha Verão" });
  });

  it.each([
    ["ACCEPT", "proposal.approved"],
    ["REQUEST_CHANGES", "proposal.changes_requested"],
    ["REJECT", "proposal.rejected"],
  ] as const)("respond %s emits %s", async (action, eventType) => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    await ProposalResponseService.respond(db, tokenOf(publicPath), {
      publicationId: publication.id,
      action,
      name: "Maria",
      email: "maria@bella.test",
      message: action === "REQUEST_CHANGES" ? "Trocar stories" : null,
    });

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    expect(events.map((event) => event.eventType)).toEqual(["proposal.sent", eventType]);
    expect(JSON.stringify(events[1].payload)).not.toContain("maria@bella.test");
  });

  it("a failed response transaction leaves no event (atomicity)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    // Fail after the event would have been appended: the status update is the last write.
    vi.spyOn(ProposalsRepository, "setStatusWithTx").mockRejectedValueOnce(new Error("boom"));

    await expect(
      ProposalResponseService.respond(db, tokenOf(publicPath), {
        publicationId: publication.id,
        action: "ACCEPT",
        name: "Maria",
        email: "maria@bella.test",
        message: null,
      }),
    ).rejects.toThrow("boom");

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    expect(events.map((event) => event.eventType)).toEqual(["proposal.sent"]);
  });

  it("a rejected response (superseded) emits nothing", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const first = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalService.update(db, organization.id, proposal.id, { title: "v2", userId: owner.id });
    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    await expect(
      ProposalResponseService.respond(db, tokenOf(first.publicPath), {
        publicationId: first.publication.id,
        action: "ACCEPT",
        name: "Maria",
        email: "maria@bella.test",
        message: null,
      }),
    ).rejects.toThrow();

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    expect(events.map((event) => event.eventType)).toEqual(["proposal.sent", "proposal.sent"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/events src/services/proposal-events-emission.test.ts`
Expected: FAIL.

- [ ] **Step 3: Builders**

```typescript
// src/lib/events/proposal-events.ts
import type { AppendEventInput } from "@/repositories/domain-events.repository";

export const PROPOSAL_EVENT = {
  SENT: "proposal.sent",
  APPROVED: "proposal.approved",
  CHANGES_REQUESTED: "proposal.changes_requested",
  REJECTED: "proposal.rejected",
} as const;

type ResponseAction = "ACCEPT" | "REQUEST_CHANGES" | "REJECT";

export const RESPONSE_EVENT: Record<ResponseAction, string> = {
  ACCEPT: PROPOSAL_EVENT.APPROVED,
  REQUEST_CHANGES: PROPOSAL_EVENT.CHANGES_REQUESTED,
  REJECT: PROPOSAL_EVENT.REJECTED,
};

const EXCERPT_MAX = 140;

export function excerpt(text: string | null, max = EXCERPT_MAX): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

interface ProposalRef {
  proposalId: string;
  proposalTitle: string;
  publicationId: string;
  versionNumber: number;
  opportunityId: string;
}

function basePayload(ref: ProposalRef) {
  return {
    proposal_id: ref.proposalId,
    proposal_title: ref.proposalTitle,
    publication_id: ref.publicationId,
    version_number: ref.versionNumber,
    opportunity_id: ref.opportunityId,
  };
}

export function proposalSentEvent(input: ProposalRef & { userId: string }): AppendEventInput {
  return {
    eventType: PROPOSAL_EVENT.SENT,
    entityType: "proposal",
    entityId: input.proposalId,
    payload: basePayload(input),
    actor: { kind: "user", user_id: input.userId },
  };
}

export function proposalResponseEvent(
  input: ProposalRef & { action: ResponseAction; respondentName: string; message: string | null },
): AppendEventInput {
  const payload: Record<string, unknown> = { ...basePayload(input), respondent_name: input.respondentName };
  if (input.action === "REQUEST_CHANGES") payload.message_excerpt = excerpt(input.message);
  if (input.action === "REJECT") payload.reason_excerpt = excerpt(input.message);
  return {
    eventType: RESPONSE_EVENT[input.action],
    entityType: "proposal",
    entityId: input.proposalId,
    payload,
    actor: { kind: "client", name: input.respondentName },
  };
}
```

- [ ] **Step 4: Emit inside the existing transactions**

In `ProposalSendingService.publish`, right after `insertWithTx` creates the publication and **before** `setStatusWithTx`:

```typescript
      await DomainEventsRepository.appendWithTx(
        tx,
        organizationId,
        proposalSentEvent({
          proposalId,
          proposalTitle: proposal.title,
          publicationId: publication.id,
          versionNumber: publication.versionNumber,
          opportunityId: proposal.opportunityId,
          userId,
        }),
      );
```

In `ProposalResponseService.respond`, right after `ProposalResponsesRepository.insertWithTx` and **before** `setStatusWithTx`:

```typescript
        await DomainEventsRepository.appendWithTx(
          tx,
          organizationId,
          proposalResponseEvent({
            proposalId: proposal.id,
            proposalTitle: proposal.title,
            publicationId: latest.id,
            versionNumber: latest.versionNumber,
            opportunityId: proposal.opportunityId,
            action: input.action,
            respondentName: input.name,
            message: input.message,
          }),
        );
```

(Nothing is emitted on the idempotent `created: false` path nor on any thrown path.)

- [ ] **Step 5: Run the tests**, full suite, build, commit:

```bash
/opt/homebrew/bin/pnpm vitest run src/lib/events src/services
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/lib/events src/services
git commit -m "feat: emit proposal domain events in the same transaction as the fact"
```

---

### Task 3: Event drain and notification handlers

**Files:**
- Create: `src/services/event-drain.service.ts`, `src/services/event-handlers/proposal-notifications.ts`
- Test: `src/services/event-drain.service.test.ts`, `src/services/event-handlers/proposal-notifications.test.ts`

**Interfaces:**
- Consumes: Task 1 repositories; Task 2 builders/constants; `seedProposal`, publish/respond.
- Produces:
  - `type EventHandler = (tx, event: DomainEvent) => Promise<void>`
  - `proposalNotificationHandlers: Record<string, EventHandler>` (keys: the three response event types)
  - `notificationCopy(event): { kind; title; body; linkPath } | null` (pure, exported for tests)
  - `EventDrainService.drain(db, options?: { limit?: number; now?: () => Date; handlers?: Record<string, EventHandler> }): Promise<{ processed: number; failed: number }>` — default limit 50, default handlers = `proposalNotificationHandlers`.

Notification copy (exact):
- `proposal.approved` → title "Proposta aceita", body `{respondent_name} aceitou "{proposal_title}".`
- `proposal.changes_requested` → title "Ajustes pedidos", body `{respondent_name} pediu ajustes em "{proposal_title}".`
- `proposal.rejected` → title "Proposta recusada", body `{respondent_name} recusou "{proposal_title}".`
- `linkPath` = `/proposals/{proposal_id}`; `kind` = event type. `proposal.sent` has no handler (marked done).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/event-handlers/proposal-notifications.test.ts
import { describe, it, expect } from "vitest";
import { notificationCopy } from "./proposal-notifications";

const event = (eventType: string) =>
  ({ eventType, payload: { proposal_id: "p1", proposal_title: "Campanha Verão", respondent_name: "Maria" } }) as never;

describe("notificationCopy", () => {
  it.each([
    ["proposal.approved", "Proposta aceita", 'Maria aceitou "Campanha Verão".'],
    ["proposal.changes_requested", "Ajustes pedidos", 'Maria pediu ajustes em "Campanha Verão".'],
    ["proposal.rejected", "Proposta recusada", 'Maria recusou "Campanha Verão".'],
  ])("%s", (type, title, body) => {
    expect(notificationCopy(event(type))).toEqual({ kind: type, title, body, linkPath: "/proposals/p1" });
  });

  it("returns null for events that do not notify", () => {
    expect(notificationCopy(event("proposal.sent"))).toBeNull();
  });
});
```

```typescript
// src/services/event-drain.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalSendingService } from "./proposal-sending.service";
import { ProposalResponseService } from "./proposal-response.service";
import { EventDrainService } from "./event-drain.service";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { NotificationsRepository } from "@/repositories/notifications.repository";

const tokenOf = (publicPath: string) => publicPath.replace("/p/", "");

describe("EventDrainService.drain", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function answered(db: Awaited<ReturnType<typeof withTestDb>>["db"]) {
    const seeded = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, seeded.organization.id, seeded.proposal.id, seeded.owner.id);
    await ProposalResponseService.respond(db, tokenOf(publicPath), {
      publicationId: publication.id,
      action: "ACCEPT",
      name: "Maria",
      email: "maria@bella.test",
      message: null,
    });
    return seeded;
  }

  it("processes events into notifications and marks them done; replays are harmless", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await answered(db);

    expect(await EventDrainService.drain(db)).toEqual({ processed: 2, failed: 0 });
    expect(await EventDrainService.drain(db)).toEqual({ processed: 0, failed: 0 });

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    expect(events.every((event) => event.status === "done")).toBe(true);
    const { items, unreadCount } = await NotificationsRepository.listForUser(db, organization.id, owner.id, 20);
    expect(unreadCount).toBe(1);
    expect(items[0]).toMatchObject({ title: "Proposta aceita", body: 'Maria aceitou "Campanha Verão".', linkPath: `/proposals/${proposal.id}` });
  });

  it("a failing handler is retried later and does not block other events", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await answered(db);

    const result = await EventDrainService.drain(db, {
      handlers: {
        "proposal.approved": async () => {
          throw new Error("temporário");
        },
      },
    });
    expect(result).toEqual({ processed: 1, failed: 1 });

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    const approved = events.find((event) => event.eventType === "proposal.approved")!;
    expect(approved).toMatchObject({ status: "pending", attempts: 1, lastError: "temporário" });
    expect(approved.nextAttemptAt).not.toBeNull();
  });

  it("respects the limit", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    await answered(db);
    expect(await EventDrainService.drain(db, { limit: 1 })).toEqual({ processed: 1, failed: 0 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/services/event-drain.service.test.ts src/services/event-handlers`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/services/event-handlers/proposal-notifications.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import type { DomainEvent } from "@/repositories/domain-events.repository";
import { NotificationsRepository } from "@/repositories/notifications.repository";
import { PROPOSAL_EVENT } from "@/lib/events/proposal-events";

export type EventHandler = (tx: NodePgDatabase<typeof schema>, event: DomainEvent) => Promise<void>;

const COPY: Record<string, { title: string; verb: (title: string) => string }> = {
  [PROPOSAL_EVENT.APPROVED]: { title: "Proposta aceita", verb: (title) => `aceitou "${title}".` },
  [PROPOSAL_EVENT.CHANGES_REQUESTED]: { title: "Ajustes pedidos", verb: (title) => `pediu ajustes em "${title}".` },
  [PROPOSAL_EVENT.REJECTED]: { title: "Proposta recusada", verb: (title) => `recusou "${title}".` },
};

export function notificationCopy(
  event: Pick<DomainEvent, "eventType" | "payload">,
): { kind: string; title: string; body: string; linkPath: string } | null {
  const copy = COPY[event.eventType];
  if (!copy) return null;
  const payload = event.payload as { proposal_id: string; proposal_title: string; respondent_name: string };
  return {
    kind: event.eventType,
    title: copy.title,
    body: `${payload.respondent_name} ${copy.verb(payload.proposal_title)}`,
    linkPath: `/proposals/${payload.proposal_id}`,
  };
}

const notify: EventHandler = async (tx, event) => {
  const copy = notificationCopy(event);
  if (!copy) return;
  await NotificationsRepository.fanOutWithTx(tx, event.organizationId, { sourceEventId: event.id, ...copy });
};

export const proposalNotificationHandlers: Record<string, EventHandler> = {
  [PROPOSAL_EVENT.APPROVED]: notify,
  [PROPOSAL_EVENT.CHANGES_REQUESTED]: notify,
  [PROPOSAL_EVENT.REJECTED]: notify,
};
```

```typescript
// src/services/event-drain.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { DomainEventsRepository, type DomainEvent } from "@/repositories/domain-events.repository";
import { proposalNotificationHandlers, type EventHandler } from "./event-handlers/proposal-notifications";

const DEFAULT_LIMIT = 50;

class HandlerFailure extends Error {
  constructor(
    readonly eventId: string,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

export const EventDrainService = {
  /**
   * Claims pending events one at a time (FOR UPDATE SKIP LOCKED, so parallel
   * drains never share an event), runs the registered handler inside the same
   * transaction and marks the event done. A failing handler rolls back its own
   * work; the failure is then recorded with backoff (or dead) outside it.
   */
  async drain(
    db: NodePgDatabase<typeof schema>,
    options: { limit?: number; now?: () => Date; handlers?: Record<string, EventHandler> } = {},
  ): Promise<{ processed: number; failed: number }> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const now = options.now ?? (() => new Date());
    const handlers = options.handlers ?? proposalNotificationHandlers;
    let processed = 0;
    let failed = 0;

    while (processed < limit) {
      let claimed: DomainEvent | null = null;
      try {
        claimed = await db.transaction(async (tx) => {
          const event = await DomainEventsRepository.claimNextWithTx(tx as unknown as NodePgDatabase<typeof schema>, now());
          if (!event) return null;
          const handler = handlers[event.eventType];
          try {
            if (handler) await handler(tx as unknown as NodePgDatabase<typeof schema>, event);
          } catch (error) {
            throw new HandlerFailure(event.id, error);
          }
          await DomainEventsRepository.markDoneWithTx(tx as unknown as NodePgDatabase<typeof schema>, event.id, now());
          return event;
        });
      } catch (error) {
        if (!(error instanceof HandlerFailure)) throw error;
        await DomainEventsRepository.recordFailure(db, error.eventId, error.message, now());
        processed += 1;
        failed += 1;
        continue;
      }
      if (!claimed) break;
      processed += 1;
    }

    return { processed, failed };
  },
};
```

(A failed event gets `next_attempt_at` in the future, so the same drain does not re-claim it.)

- [ ] **Step 4: Run the tests**, full suite, build, commit:

```bash
/opt/homebrew/bin/pnpm vitest run src/services/event-drain.service.test.ts src/services/event-handlers
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/services
git commit -m "feat: drain domain events into in-app notifications"
```

---

### Task 4: Drain route, Vercel Cron and post-response kick

**Files:**
- Create: `src/app/api/internal/events/drain/route.ts`, `src/lib/events/schedule-drain.ts`, `vercel.json`
- Modify: `src/app/api/proposals/[id]/publications/route.ts` (POST), `src/app/api/public/proposals/[token]/responses/route.ts` (POST), `.env.example`
- Test: `src/app/api/internal/events/drain/route.test.ts`, `src/lib/events/schedule-drain.test.ts`

**Interfaces:**
- Consumes: `EventDrainService.drain` (Task 3).
- Produces: `scheduleEventDrain(): void` — calls `after(() => EventDrainService.drain(db, { limit: 20 }))`; swallows the "outside request scope" error (tests/scripts) because the cron guarantees delivery. `GET|POST /api/internal/events/drain` → `200 { processed, failed }` | `401` | `503`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/api/internal/events/drain/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalSendingService } from "@/services/proposal-sending.service";

const request = (method: "GET" | "POST", token?: string) =>
  new Request("http://localhost/api/internal/events/drain", {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe("/api/internal/events/drain", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanup?.();
  });

  it("503 when CRON_SECRET is not configured (fail-closed)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.stubEnv("CRON_SECRET", "");
    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });
    expect((await GET(request("GET", "anything"))).status).toBe(503);
  });

  it("401 without or with a wrong bearer token", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.stubEnv("CRON_SECRET", "s3cret");
    const { GET, POST } = await importRouteWithSession(() => import("./route"), { db, session: null });
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", "wrong"))).status).toBe(401);
  });

  it("200 drains pending events with the right token (GET for cron, POST for kicks)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.stubEnv("CRON_SECRET", "s3cret");
    const { organization, owner, proposal } = await seedProposal(db);
    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const { GET, POST } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const response = await GET(request("GET", "s3cret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1, failed: 0 });
    expect(await (await POST(request("POST", "s3cret"))).json()).toEqual({ processed: 0, failed: 0 });
  });
});
```

```typescript
// src/lib/events/schedule-drain.test.ts
import { describe, it, expect, vi } from "vitest";

describe("scheduleEventDrain", () => {
  it("does not throw outside a request scope", async () => {
    vi.resetModules();
    vi.doMock("next/server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("next/server")>()),
      after: () => {
        throw new Error("`after` was called outside a request scope");
      },
    }));
    vi.doMock("@/db", () => ({ db: {} }));
    const { scheduleEventDrain } = await import("./schedule-drain");
    expect(() => scheduleEventDrain()).not.toThrow();
  });

  it("schedules a bounded drain after the response", async () => {
    vi.resetModules();
    const afterMock = vi.fn();
    const drain = vi.fn(async () => ({ processed: 0, failed: 0 }));
    vi.doMock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: afterMock }));
    vi.doMock("@/db", () => ({ db: { marker: true } }));
    vi.doMock("@/services/event-drain.service", () => ({ EventDrainService: { drain } }));
    const { scheduleEventDrain } = await import("./schedule-drain");

    scheduleEventDrain();
    expect(afterMock).toHaveBeenCalledTimes(1);
    await afterMock.mock.calls[0][0]();
    expect(drain).toHaveBeenCalledWith({ marker: true }, { limit: 20 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/app/api/internal src/lib/events/schedule-drain.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/lib/events/schedule-drain.ts
import { after } from "next/server";
import { db } from "@/db";
import { EventDrainService } from "@/services/event-drain.service";

/**
 * Low-latency kick: drain a few events right after the response is sent.
 * The Vercel Cron on /api/internal/events/drain is the guarantee; this is
 * only an optimization, so any failure to schedule is ignored.
 */
export function scheduleEventDrain(): void {
  try {
    after(async () => {
      try {
        await EventDrainService.drain(db, { limit: 20 });
      } catch (error) {
        console.error("post-response event drain failed", error);
      }
    });
  } catch {
    // Outside a request scope (tests, scripts): the cron will drain.
  }
}
```

```typescript
// src/app/api/internal/events/drain/route.ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { EventDrainService } from "@/services/event-drain.service";

// Vercel Cron calls GET with `Authorization: Bearer ${CRON_SECRET}`.
async function drain(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await EventDrainService.drain(db);
  return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
export { drain as GET, drain as POST };
```

```json
// vercel.json
{
  "crons": [{ "path": "/api/internal/events/drain", "schedule": "* * * * *" }]
}
```

(Per-minute crons need a Vercel Pro plan; on Hobby, Vercel accepts only daily schedules — the post-response kick then carries latency and the daily cron sweeps retries. Say so in the report.)

In `src/app/api/proposals/[id]/publications/route.ts` POST, after a successful publish and before returning: `if (result.created) scheduleEventDrain();`. In `src/app/api/public/proposals/[token]/responses/route.ts` POST, after a successful `respond` and before returning 201: `scheduleEventDrain();`. Import from `@/lib/events/schedule-drain`.

Append to `.env.example`:

```
# Domain events worker (Vercel Cron sends it as a Bearer token to /api/internal/events/drain).
# Generate with: openssl rand -hex 32
CRON_SECRET=
```

- [ ] **Step 4: Run the tests** (including the existing publications and public responses route tests, which must still pass), full suite, build, commit:

```bash
/opt/homebrew/bin/pnpm vitest run src/app/api src/lib/events
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/app/api src/lib/events vercel.json .env.example
git commit -m "feat: add cron-backed event drain and post-response kick"
```

---

### Task 5: Notifications API, hooks and the header bell

**Files:**
- Create: `src/app/api/notifications/route.ts` (GET), `src/app/api/notifications/[id]/route.ts` (PATCH), `src/app/api/notifications/read-all/route.ts` (POST), `src/hooks/use-notifications.ts`, `src/components/shell/notifications-bell.tsx`
- Modify: `src/components/shell/header.tsx`
- Test: `src/app/api/notifications/route.test.ts`, `src/components/shell/notifications-bell.test.tsx`

**Interfaces:**
- Consumes: `NotificationsRepository` (Task 1); `getSession`, `unauthorizedResponse`, `importRouteWithSession`, `ownerSession`; `Popover*`, `Button`; `formatDateTime`.
- Produces (HTTP):
  - `GET /api/notifications` → `{ items: NotificationDto[]; unreadCount: number }` (latest 20, `Cache-Control: no-store`);
  - `PATCH /api/notifications/[id]` `{ read: true }` → `204` | `404` (not the user's);
  - `POST /api/notifications/read-all` → `{ updated: number }`;
  - all return `401` without a session.
- Produces (hooks):
  - `notificationsQueryKey = ["notifications"]`;
  - `useNotifications()` (refetchInterval 30s, refetchOnWindowFocus);
  - `useMarkNotificationRead()`, `useMarkAllNotificationsRead()` (invalidate `notificationsQueryKey`).
  - `NotificationDto { id; kind; title; body: string | null; linkPath: string | null; readAt: string | null; createdAt: string }`.
- Produces (UI): `NotificationsBell`.
  - A button with `aria-label="Notificações"` and an unread badge.
  - A popover titled "Notificações" with "Marcar todas como lidas".
  - Each item shows title, body and date; clicking marks it read and navigates to `linkPath`.
  - Empty state: "Nenhuma notificação."

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/api/notifications/route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { NotificationsRepository } from "@/repositories/notifications.repository";

async function seedNotification(db: Awaited<ReturnType<typeof withTestDb>>["db"]) {
  const seeded = await seedProposal(db);
  const event = await db.transaction((tx) =>
    DomainEventsRepository.appendWithTx(tx, seeded.organization.id, {
      eventType: "proposal.approved",
      entityType: "proposal",
      entityId: seeded.proposal.id,
      payload: {},
      actor: {},
    }),
  );
  await db.transaction((tx) =>
    NotificationsRepository.fanOutWithTx(tx, seeded.organization.id, {
      sourceEventId: event.id,
      kind: "proposal.approved",
      title: "Proposta aceita",
      body: 'Maria aceitou "Campanha Verão".',
      linkPath: `/proposals/${seeded.proposal.id}`,
    }),
  );
  return seeded;
}

describe("notifications API", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("lists, marks one read and marks all read for the session user only", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedNotification(db);
    const b = await seedNotification(db);
    const session = ownerSession(a.organization.id, a.owner.id);

    const list = await importRouteWithSession(() => import("./route"), { db, session });
    const listed = await (await list.GET(new Request("http://localhost/api/notifications"))).json();
    expect(listed.unreadCount).toBe(1);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].title).toBe("Proposta aceita");

    const one = await importRouteWithSession(() => import("./[id]/route"), { db, session });
    const patch = (id: string) =>
      one.PATCH(
        new Request(`http://localhost/api/notifications/${id}`, { method: "PATCH", body: JSON.stringify({ read: true }) }),
        { params: Promise.resolve({ id }) },
      );
    const bList = await NotificationsRepository.listForUser(db, b.organization.id, b.owner.id, 20);
    expect((await patch(bList.items[0].id)).status).toBe(404);
    expect((await patch(listed.items[0].id)).status).toBe(204);

    const all = await importRouteWithSession(() => import("./read-all/route"), { db, session });
    expect(await (await all.POST(new Request("http://localhost/api/notifications/read-all", { method: "POST" }))).json()).toEqual({
      updated: 0,
    });
  });

  it("401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const list = await importRouteWithSession(() => import("./route"), { db, session: null });
    expect((await list.GET(new Request("http://localhost/api/notifications"))).status).toBe(401);
  });
});
```

```tsx
// src/components/shell/notifications-bell.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
let data: { items: unknown[]; unreadCount: number } | undefined;
const markRead = vi.fn();
const markAll = vi.fn();
vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({ data }),
  useMarkNotificationRead: () => ({ mutate: markRead }),
  useMarkAllNotificationsRead: () => ({ mutate: markAll, isPending: false }),
}));

import { NotificationsBell } from "./notifications-bell";

const item = {
  id: "n1",
  kind: "proposal.approved",
  title: "Proposta aceita",
  body: 'Maria aceitou "Campanha Verão".',
  linkPath: "/proposals/p1",
  readAt: null,
  createdAt: "2026-09-26T15:00:00.000Z",
};

describe("NotificationsBell", () => {
  beforeEach(() => {
    pushMock.mockReset();
    markRead.mockReset();
    markAll.mockReset();
  });

  it("shows the unread count and opens the list", async () => {
    data = { items: [item], unreadCount: 1 };
    render(<NotificationsBell />);
    expect(screen.getByRole("button", { name: "Notificações" })).toHaveTextContent("1");

    await userEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(screen.getByText("Proposta aceita")).toBeInTheDocument();
    expect(screen.getByText('Maria aceitou "Campanha Verão".')).toBeInTheDocument();
  });

  it("clicking an item marks it read and navigates", async () => {
    data = { items: [item], unreadCount: 1 };
    render(<NotificationsBell />);
    await userEvent.click(screen.getByRole("button", { name: "Notificações" }));
    await userEvent.click(screen.getByRole("button", { name: /Proposta aceita/ }));
    expect(markRead).toHaveBeenCalledWith("n1");
    expect(pushMock).toHaveBeenCalledWith("/proposals/p1");
  });

  it("marks all as read", async () => {
    data = { items: [item], unreadCount: 1 };
    render(<NotificationsBell />);
    await userEvent.click(screen.getByRole("button", { name: "Notificações" }));
    await userEvent.click(screen.getByRole("button", { name: "Marcar todas como lidas" }));
    expect(markAll).toHaveBeenCalled();
  });

  it("empty state and no badge", async () => {
    data = { items: [], unreadCount: 0 };
    render(<NotificationsBell />);
    expect(screen.getByRole("button", { name: "Notificações" })).not.toHaveTextContent(/\d/);
    await userEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(screen.getByText("Nenhuma notificação.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/app/api/notifications src/components/shell/notifications-bell.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Routes**

```typescript
// src/app/api/notifications/route.ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { NotificationsRepository } from "@/repositories/notifications.repository";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function GET(_request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const result = await NotificationsRepository.listForUser(db, session.organizationId, session.userId, 20);
  return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}
```

```typescript
// src/app/api/notifications/[id]/route.ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { NotificationsRepository } from "@/repositories/notifications.repository";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Notificação não encontrada." }, { status: 404 });
  const updated = await NotificationsRepository.markRead(db, session.organizationId, session.userId, id, new Date());
  if (!updated) return NextResponse.json({ error: "Notificação não encontrada." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
```

```typescript
// src/app/api/notifications/read-all/route.ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { NotificationsRepository } from "@/repositories/notifications.repository";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function POST(_request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const updated = await NotificationsRepository.markAllRead(db, session.organizationId, session.userId, new Date());
  return NextResponse.json({ updated }, { status: 200 });
}
```

- [ ] **Step 4: Hooks and bell**

```typescript
// src/hooks/use-notifications.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface NotificationDto {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationsQueryKey = ["notifications"] as const;

export function useNotifications() {
  return useQuery({
    queryKey: notificationsQueryKey,
    queryFn: () => apiFetch<{ items: NotificationDto[]; unreadCount: number }>("/api/notifications"),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/notifications/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read: true }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationsQueryKey }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ updated: number }>("/api/notifications/read-all", { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationsQueryKey }),
  });
}
```

```tsx
// src/components/shell/notifications-bell.tsx
"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/presentation/format";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "@/hooks/use-notifications";

export function NotificationsBell() {
  const router = useRouter();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unread = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="Notificações" className="relative">
          <Bell className="size-4" aria-hidden="true" />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">Notificações</p>
          <Button type="button" variant="ghost" size="sm" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
            Marcar todas como lidas
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma notificação.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn("flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted", !item.readAt && "bg-primary/5")}
                  onClick={() => {
                    if (!item.readAt) markRead.mutate(item.id);
                    if (item.linkPath) router.push(item.linkPath);
                  }}
                >
                  <span className="text-sm font-medium">{item.title}</span>
                  {item.body ? <span className="text-sm text-muted-foreground">{item.body}</span> : null}
                  <span className="text-xs text-muted-foreground">{formatDateTime(new Date(item.createdAt))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

In `src/components/shell/header.tsx`, render `<NotificationsBell />` right before `<CreatorSwitcher />`.

- [ ] **Step 5: Run the tests**, full suite, build, commit:

```bash
/opt/homebrew/bin/pnpm vitest run src/app/api/notifications src/components/shell
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/app/api/notifications src/hooks/use-notifications.ts src/components/shell
git commit -m "feat: add notifications API and header bell"
```

---

### Task 6: Share without API (WhatsApp click-to-chat, e-mail, copy)

**Files:**
- Create: `src/lib/share-links.ts`, `src/services/proposal-share.service.ts`, `src/app/api/proposals/[id]/share-info/route.ts`, `src/hooks/use-proposal-share-info.ts`, `src/components/proposals/proposal-share-actions.tsx`
- Modify: `src/components/proposals/proposal-send-panel.tsx` (post-send dialog + link actions row)
- Test: `src/lib/share-links.test.ts`, `src/services/proposal-share.service.test.ts`, `src/components/proposals/proposal-share-actions.test.tsx`

**Interfaces:**
- Consumes: `seedProposal` (its contact "Maria Fernandes" has no phone/email — tests set them); `OpportunitiesRepository.findByIdWithTx`; creators; leads; contacts; `runInTenantContext`.
- Produces:
  - `normalizeWhatsAppPhone(phone: string | null): string | null` — digits only; 10–11 digits → `55` + digits; 12–13 digits kept; otherwise null.
  - `buildShareMessage({ contactName: string | null; creatorName: string; proposalTitle: string; url: string }): string` → `Olá, {primeiro nome}! Segue a proposta "{título}" de {creator}: {url}`; without a contact name it starts with `Olá! `.
  - `buildWhatsAppUrl(phone: string | null, message: string): string` → `https://wa.me/{digits}?text={encoded}`, or `https://wa.me/?text={encoded}` without a phone.
  - `buildMailtoUrl(email: string | null, subject: string, body: string): string` → `mailto:{email}?subject=…&body=…` (empty address allowed).
  - `ProposalShareService.getShareInfo(db, orgId, proposalId): Promise<{ proposalTitle: string; creatorName: string; contact: { name: string; phone: string | null; email: string | null } | null } | null>`
  - `GET /api/proposals/[id]/share-info` → that object | `404` | `401`.
  - `useProposalShareInfo(proposalId)`.
  - `ProposalShareActions({ proposalId, publicPath })`: link buttons "WhatsApp" (new tab), "E-mail" (mailto) and "Copiar mensagem" (clipboard + toast "Mensagem copiada.").
  - E-mail subject: `Proposta: {título}`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/share-links.test.ts
import { describe, it, expect } from "vitest";
import { buildMailtoUrl, buildShareMessage, buildWhatsAppUrl, normalizeWhatsAppPhone } from "./share-links";

describe("share links", () => {
  it("normalizes Brazilian phones for wa.me", () => {
    expect(normalizeWhatsAppPhone("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizeWhatsAppPhone("11 3456-7890")).toBe("551134567890");
    expect(normalizeWhatsAppPhone("+55 11 98765-4321")).toBe("5511987654321");
    expect(normalizeWhatsAppPhone("+1 415 555 0100")).toBe(null);
    expect(normalizeWhatsAppPhone("123")).toBeNull();
    expect(normalizeWhatsAppPhone(null)).toBeNull();
  });

  it("builds the message with the contact's first name", () => {
    expect(buildShareMessage({ contactName: "Maria Fernandes", creatorName: "Thais", proposalTitle: "Campanha Verão", url: "https://x/p/t" })).toBe(
      'Olá, Maria! Segue a proposta "Campanha Verão" de Thais: https://x/p/t',
    );
    expect(buildShareMessage({ contactName: null, creatorName: "Thais", proposalTitle: "Campanha", url: "u" })).toBe(
      'Olá! Segue a proposta "Campanha" de Thais: u',
    );
  });

  it("builds wa.me and mailto URLs", () => {
    expect(buildWhatsAppUrl("5511987654321", "Oi & tchau")).toBe("https://wa.me/5511987654321?text=Oi%20%26%20tchau");
    expect(buildWhatsAppUrl(null, "Oi")).toBe("https://wa.me/?text=Oi");
    expect(buildMailtoUrl("maria@bella.test", "Proposta: X", "Corpo & link")).toBe(
      "mailto:maria@bella.test?subject=Proposta%3A%20X&body=Corpo%20%26%20link",
    );
    expect(buildMailtoUrl(null, "S", "B")).toBe("mailto:?subject=S&body=B");
  });
});
```

(`+1 415 555 0100` has 11 digits starting with 1 — the Brazilian rule would wrongly prefix 55. Rule: when the input starts with `+`, keep the digits as-is only if they start with `55`; otherwise return null. Encode that rule in the implementation; the test above pins it.)

```typescript
// src/services/proposal-share.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalShareService } from "./proposal-share.service";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads } from "@/db/schema/commercial-flow";

describe("ProposalShareService.getShareInfo", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns title, creator and the opportunity's contact", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, opportunity, proposal } = await seedProposal(db);
    const [lead] = await db.select().from(leads).where(eq(leads.id, opportunity.leadId));
    await db.update(contacts).set({ phone: "(11) 98765-4321", email: "maria@bella.test" }).where(eq(contacts.id, lead.contactId));

    expect(await ProposalShareService.getShareInfo(db, organization.id, proposal.id)).toEqual({
      proposalTitle: "Campanha Verão",
      creatorName: "Thais",
      contact: { name: "Maria Fernandes", phone: "(11) 98765-4321", email: "maria@bella.test" },
    });
  });

  it("returns null for another organization's proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    expect(await ProposalShareService.getShareInfo(db, b.organization.id, a.proposal.id)).toBeNull();
  });
});
```

```tsx
// src/components/proposals/proposal-share-actions.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-proposal-share-info", () => ({
  useProposalShareInfo: () => ({
    data: { proposalTitle: "Campanha Verão", creatorName: "Thais", contact: { name: "Maria Fernandes", phone: "(11) 98765-4321", email: "maria@bella.test" } },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProposalShareActions } from "./proposal-share-actions";

describe("ProposalShareActions", () => {
  it("links WhatsApp and e-mail with the prepared message", () => {
    render(<ProposalShareActions proposalId="p1" publicPath="/p/tok" />);
    const url = `${window.location.origin}/p/tok`;
    const message = `Olá, Maria! Segue a proposta "Campanha Verão" de Thais: ${url}`;

    const whatsapp = screen.getByRole("link", { name: "WhatsApp" });
    expect(whatsapp).toHaveAttribute("href", `https://wa.me/5511987654321?text=${encodeURIComponent(message)}`);
    expect(whatsapp).toHaveAttribute("target", "_blank");
    expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");

    expect(screen.getByRole("link", { name: "E-mail" })).toHaveAttribute(
      "href",
      `mailto:maria@bella.test?subject=${encodeURIComponent("Proposta: Campanha Verão")}&body=${encodeURIComponent(message)}`,
    );
    expect(screen.getByRole("button", { name: "Copiar mensagem" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/share-links.test.ts src/services/proposal-share.service.test.ts src/components/proposals/proposal-share-actions.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/lib/share-links.ts
/** wa.me needs the full international number, digits only. Brazil-first. */
export function normalizeWhatsAppPhone(phone: string | null): string | null {
  if (!phone) return null;
  const international = phone.trim().startsWith("+");
  const digits = phone.replace(/\D/g, "");
  if (international) return digits.startsWith("55") && (digits.length === 12 || digits.length === 13) ? digits : null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  return null;
}

export function buildShareMessage(input: { contactName: string | null; creatorName: string; proposalTitle: string; url: string }): string {
  const firstName = input.contactName?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Olá, ${firstName}!` : "Olá!";
  return `${greeting} Segue a proposta "${input.proposalTitle}" de ${input.creatorName}: ${input.url}`;
}

export function buildWhatsAppUrl(phone: string | null, message: string): string {
  return `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(message)}`;
}

export function buildMailtoUrl(email: string | null, subject: string, body: string): string {
  return `mailto:${email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
```

```typescript
// src/services/proposal-share.service.ts
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { leads } from "@/db/schema/commercial-flow";
import { contacts } from "@/db/schema/companies-brands-contacts";

export interface ShareInfo {
  proposalTitle: string;
  creatorName: string;
  contact: { name: string; phone: string | null; email: string | null } | null;
}

export const ProposalShareService = {
  async getShareInfo(db: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string): Promise<ShareInfo | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
      if (!proposal) return null;
      const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, proposal.opportunityId);
      if (!opportunity) return null;
      const creator = await CreatorsRepository.findByIdWithTx(tx, organizationId, opportunity.creatorId);
      const [row] = await tx
        .select({ name: contacts.fullName, phone: contacts.phone, email: contacts.email })
        .from(leads)
        .innerJoin(contacts, eq(contacts.id, leads.contactId))
        .where(and(eq(leads.id, opportunity.leadId), eq(leads.organizationId, organizationId)));
      return { proposalTitle: proposal.title, creatorName: creator?.displayName ?? "", contact: row ?? null };
    });
  },
};
```

```typescript
// src/app/api/proposals/[id]/share-info/route.ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { ProposalShareService } from "@/services/proposal-share.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const { id } = await params;
  const info = UUID_RE.test(id) ? await ProposalShareService.getShareInfo(db, session.organizationId, id) : null;
  if (!info) return NextResponse.json({ error: `Proposal ${id} not found` }, { status: 404 });
  return NextResponse.json(info, { status: 200 });
}
```

```typescript
// src/hooks/use-proposal-share-info.ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface ShareInfoDto {
  proposalTitle: string;
  creatorName: string;
  contact: { name: string; phone: string | null; email: string | null } | null;
}

export function useProposalShareInfo(proposalId: string) {
  return useQuery({
    queryKey: ["proposal-share-info", proposalId],
    queryFn: () => apiFetch<ShareInfoDto>(`/api/proposals/${proposalId}/share-info`),
  });
}
```

```tsx
// src/components/proposals/proposal-share-actions.tsx
"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useProposalShareInfo } from "@/hooks/use-proposal-share-info";
import { buildMailtoUrl, buildShareMessage, buildWhatsAppUrl, normalizeWhatsAppPhone } from "@/lib/share-links";

/** Share without a channel API: nothing is recorded as sent (no delivery confirmation). */
export function ProposalShareActions({ proposalId, publicPath }: { proposalId: string; publicPath: string }) {
  const { data } = useProposalShareInfo(proposalId);
  if (!data) return null;

  const url = typeof window === "undefined" ? publicPath : `${window.location.origin}${publicPath}`;
  const message = buildShareMessage({
    contactName: data.contact?.name ?? null,
    creatorName: data.creatorName,
    proposalTitle: data.proposalTitle,
    url,
  });

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Mensagem copiada.");
    } catch {
      toast.error("Não foi possível copiar a mensagem.");
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm" variant="outline">
        <a href={buildWhatsAppUrl(normalizeWhatsAppPhone(data.contact?.phone ?? null), message)} target="_blank" rel="noopener noreferrer">
          WhatsApp
        </a>
      </Button>
      <Button asChild size="sm" variant="outline">
        <a href={buildMailtoUrl(data.contact?.email ?? null, `Proposta: ${data.proposalTitle}`, message)}>E-mail</a>
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={copyMessage}>
        Copiar mensagem
      </Button>
    </div>
  );
}
```

In `proposal-send-panel.tsx`:
- **Post-send dialog:** under the existing link input and the "Copiar link"/"Abrir" row, add a label `<p className="text-xs text-muted-foreground">Ou envie direto:</p>` followed by `<ProposalShareActions proposalId={proposalId} publicPath={sentPath} />`.
- **Link-actions row** (rendered when `state.publicPath` exists): add `<ProposalShareActions proposalId={proposalId} publicPath={state.publicPath} />` after "Abrir".
- **Panel tests:** mock `@/hooks/use-proposal-share-info` so they don't fetch; add `vi.mock("@/hooks/use-proposal-share-info", () => ({ useProposalShareInfo: () => ({ data: undefined }) }))`.

- [ ] **Step 4: Run the tests**, full suite, build, commit:

```bash
/opt/homebrew/bin/pnpm vitest run src/lib/share-links.test.ts src/services/proposal-share.service.test.ts src/components/proposals
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/lib/share-links.ts src/lib/share-links.test.ts src/services/proposal-share.service.ts src/services/proposal-share.service.test.ts "src/app/api/proposals/[id]/share-info" src/hooks/use-proposal-share-info.ts src/components/proposals
git commit -m "feat: share proposals via WhatsApp click-to-chat, e-mail and copied message"
```

---

## Visual verification (controller, after Task 6, before the final review)

Run in the browser pane on the worktree dev server, with the user logged in:

1. Publish a proposal. The post-send dialog shows "WhatsApp", "E-mail" and "Copiar mensagem".
   - The WhatsApp href is a `wa.me` link with the prepared message.
   - The mailto link carries the subject.
2. Respond as the client through the public link (accept).
3. Wait, or call the drain with the bearer (`curl -H "Authorization: Bearer $CRON_SECRET" …/api/internal/events/drain`). The bell shows **1**, and the item reads "Proposta aceita — Maria aceitou "…"".
4. Click the item. It navigates to the builder and the badge clears.
5. Check the database:
   - both events are `done`;
   - there is exactly one notification per member.

## Self-Review

**Spec coverage:**

| Spec section | Where it is covered |
|---|---|
| §4.1 outbox, same transaction | Task 2 (atomicity tests) |
| §4.2 catalog, no PII | Task 2 |
| §4.3 worker: SKIP LOCKED, backoff, dead | Tasks 1 and 3 |
| §4.3 Vercel Cron and post-commit kick | Task 4 (`after()`) |
| §3.2 notifications, per-member refinement | Tasks 1, 3 and 5 |
| §10 Fase 0 share without API | Task 6 |
| §12 recommendation | Tasks 1–6 |

Out of scope and untouched: `channel_accounts`, templates, identities, conversation/message changes.

**Placeholder scan:** every step has complete code. The notes only cover verifying the installed Drizzle API names (`check`, partial index, `for(…, { skipLocked })`), and the Vercel plan limitation.

**Type consistency:** each interface is defined once and consumed later with the same names.

| Interface | Defined in | Used in |
|---|---|---|
| `AppendEventInput`, `DomainEvent`, `DomainEventsRepository`, `NotificationsRepository` | Task 1 | Tasks 2, 3 and 5 |
| `PROPOSAL_EVENT`, builders | Task 2 | Task 3 |
| `EventDrainService.drain`, `EventHandler` | Task 3 | Task 4 |
| `NotificationDto`, hooks | Task 5 | Bell |
| `ShareInfo`/`ShareInfoDto`, share builders | Task 6 | Task 6 |
