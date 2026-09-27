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

  /**
   * Atomic single UPDATE: `attempts`, `status` and `next_attempt_at` are all
   * computed in SQL from the row's current `attempts`, so this is safe to
   * call while still holding the row's lock from the same claim transaction
   * (no read-modify-write race with a concurrent claimer). Guarded by
   * `status = 'pending'`; returns null if the row wasn't found in that state.
   * Backoff: min(2^attempts, 60) minutes, using the new attempts count; the
   * event goes dead once that count reaches MAX_EVENT_ATTEMPTS.
   */
  async recordFailureWithTx(tx: NodePgDatabase<typeof schema>, eventId: string, error: string, now: Date): Promise<DomainEvent | null> {
    const [updated] = await tx
      .update(domainEvents)
      .set({
        attempts: sql`${domainEvents.attempts} + 1`,
        status: sql`case when ${domainEvents.attempts} + 1 >= ${MAX_EVENT_ATTEMPTS} then 'dead' else 'pending' end`,
        nextAttemptAt: sql`case when ${domainEvents.attempts} + 1 >= ${MAX_EVENT_ATTEMPTS}
          then null
          else ${now}::timestamptz + (interval '1 minute' * least(power(2, ${domainEvents.attempts} + 1), 60))
          end`,
        lastError: error.slice(0, 1000),
      })
      .where(and(eq(domainEvents.id, eventId), eq(domainEvents.status, "pending")))
      .returning();
    return updated ?? null;
  },

  async listForEntity(db: NodePgDatabase<typeof schema>, organizationId: string, entityType: string, entityId: string): Promise<DomainEvent[]> {
    return db
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.organizationId, organizationId), eq(domainEvents.entityType, entityType), eq(domainEvents.entityId, entityId)))
      .orderBy(asc(domainEvents.occurredAt), sql`${domainEvents.id}`);
  },
};
