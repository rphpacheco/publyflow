import { sql } from "drizzle-orm";
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

  it("goes dead after the 5th failed attempt, incrementing attempts under an advancing clock", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await answered(db);
    let now = new Date("2026-09-26T12:00:00Z");
    const handlers = {
      "proposal.approved": async () => {
        throw new Error("boom");
      },
    };

    for (let i = 0; i < 5; i += 1) {
      const result = await EventDrainService.drain(db, { handlers, now: () => now });
      expect(result.failed).toBe(1);
      now = new Date(now.getTime() + 61 * 60_000); // past any possible backoff (max 60 min)
    }

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    const approved = events.find((event) => event.eventType === "proposal.approved")!;
    expect(approved).toMatchObject({ status: "dead", attempts: 5 });
  });

  it("a handler that throws a DB error still lets the failure be recorded (savepoint keeps the outer tx usable)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await answered(db);

    const result = await EventDrainService.drain(db, {
      handlers: {
        "proposal.approved": async (tx) => {
          // Deliberately invalid: violates the not-null columns, causing a
          // real Postgres error mid-handler (not a thrown JS Error).
          await tx.execute(sql`insert into domain_events (id) values (gen_random_uuid())`);
        },
      },
    });
    expect(result).toEqual({ processed: 1, failed: 1 });

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    const approved = events.find((event) => event.eventType === "proposal.approved")!;
    expect(approved).toMatchObject({ status: "pending", attempts: 1 });
  });
});
