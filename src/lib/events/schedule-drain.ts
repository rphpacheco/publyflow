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
