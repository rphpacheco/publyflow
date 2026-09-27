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
