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

    const once = await db.transaction((tx) => DomainEventsRepository.recordFailureWithTx(tx, event.id, "boom", now));
    expect(once).toMatchObject({ status: "pending", attempts: 1, lastError: "boom" });
    expect(once!.nextAttemptAt?.toISOString()).toBe("2026-09-26T12:02:00.000Z");

    // not claimable before its next attempt
    const early = await db.transaction((tx) => DomainEventsRepository.claimNextWithTx(tx, now));
    expect(early).toBeNull();

    let last = once;
    for (let i = 0; i < 4; i += 1) {
      last = await db.transaction((tx) => DomainEventsRepository.recordFailureWithTx(tx, event.id, "boom", now));
    }
    expect(last).toMatchObject({ status: "dead", attempts: 5 });
  });

  it("recordFailureWithTx is a no-op (returns null) for an event that is no longer pending", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await seedProposal(db);
    const event = await db.transaction((tx) => DomainEventsRepository.appendWithTx(tx, organization.id, append(organization.id, proposal.id)));
    const now = new Date("2026-09-26T12:00:00Z");
    await db.transaction(async (tx) => {
      const claimed = await DomainEventsRepository.claimNextWithTx(tx, now);
      await DomainEventsRepository.markDoneWithTx(tx, claimed!.id, now);
    });

    const result = await db.transaction((tx) => DomainEventsRepository.recordFailureWithTx(tx, event.id, "boom", now));
    expect(result).toBeNull();
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
