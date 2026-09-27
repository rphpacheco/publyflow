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

    while (processed + failed < limit) {
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
        failed += 1;
        continue;
      }
      if (!claimed) break;
      processed += 1;
    }

    return { processed, failed };
  },
};
