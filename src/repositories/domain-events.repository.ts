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
