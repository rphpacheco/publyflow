import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { proposalNotificationHandlers, type EventHandler } from "./event-handlers/proposal-notifications";

const DEFAULT_LIMIT = 50;

type Outcome = "processed" | "failed" | null;

export const EventDrainService = {
  /**
   * Claims pending events one at a time (FOR UPDATE SKIP LOCKED, so parallel
   * drains never share an event) and keeps a single outer transaction per
   * claimed event for its whole lifecycle. The handler runs inside a nested
   * transaction (a savepoint): if it throws, only the handler's partial
   * writes roll back, and the failure is then recorded — still inside the
   * outer transaction, still holding the row's lock — as one atomic UPDATE,
   * so a concurrent drain can never re-claim the row mid-bookkeeping.
   *
   * Return semantics: `processed` counts events marked done (no handler, or
   * the handler ran without throwing); `failed` counts events whose handler
   * threw (recorded with backoff, or marked dead after the 5th attempt).
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

    while (processed + failed < limit) {
      const outcome: Outcome = await db.transaction(async (tx) => {
        const txDb = tx as unknown as NodePgDatabase<typeof schema>;
        const event = await DomainEventsRepository.claimNextWithTx(txDb, now());
        if (!event) return null;

        // Fan-out and future RLS-enforced reads scope to this event's org.
        await txDb.execute(sql`select set_config('app.current_org_id', ${event.organizationId}, true)`);

        const handler = handlers[event.eventType];
        if (handler) {
          try {
            await txDb.transaction((sp) => handler(sp as unknown as NodePgDatabase<typeof schema>, event));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await DomainEventsRepository.recordFailureWithTx(txDb, event.id, message, now());
            return "failed";
          }
        }
        await DomainEventsRepository.markDoneWithTx(txDb, event.id, now());
        return "processed";
      });

      if (outcome === null) break;
      if (outcome === "failed") failed += 1;
      else processed += 1;
    }

    return { processed, failed };
  },
};
