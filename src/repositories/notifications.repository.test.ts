import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { organizationMembers, users } from "@/db/schema/organizations";
import { domainEvents } from "@/db/schema/domain-events";
import { NotificationsRepository } from "./notifications.repository";

describe("NotificationsRepository.fanOutWithTx audience", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const [manager] = await db.insert(users).values({ email: "manager@publyflow.test", fullName: "Manager" }).returning();
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: manager.id, role: "MANAGER" });
    const [creatorA] = await db.insert(users).values({ email: "creator-a@publyflow.test", fullName: "Creator A" }).returning();
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creatorA.id, role: "CREATOR" });
    const [creatorB] = await db.insert(users).values({ email: "creator-b@publyflow.test", fullName: "Creator B" }).returning();
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creatorB.id, role: "CREATOR" });
    return { db, organization, owner, manager, creatorA, creatorB };
  }

  async function input(db: Awaited<ReturnType<typeof setup>>["db"], organizationId: string, suffix: string) {
    const [{ id }] = await db
      .insert(domainEvents)
      .values({ organizationId, eventType: "test.event", entityType: "test", entityId: null })
      .returning({ id: domainEvents.id });
    return { sourceEventId: id, kind: `test.kind.${suffix}`, title: "T", body: "B", linkPath: null };
  }

  it("only: creator inserts exactly one row for the target creator", async () => {
    const { db, organization, creatorA } = await setup();
    const count = await NotificationsRepository.fanOutWithTx(db, organization.id, await input(db, organization.id, "a"), { creatorUserId: creatorA.id, only: "creator" });
    expect(count).toBe(1);
    const { items } = await NotificationsRepository.listForUser(db, organization.id, creatorA.id, 10);
    expect(items).toHaveLength(1);
  });

  it("only: staff inserts rows for OWNER and MANAGER only", async () => {
    const { db, organization, owner, manager, creatorA } = await setup();
    const count = await NotificationsRepository.fanOutWithTx(db, organization.id, await input(db, organization.id, "b"), { creatorUserId: creatorA.id, only: "staff" });
    expect(count).toBe(2);
    expect((await NotificationsRepository.listForUser(db, organization.id, owner.id, 10)).items).toHaveLength(1);
    expect((await NotificationsRepository.listForUser(db, organization.id, manager.id, 10)).items).toHaveLength(1);
    expect((await NotificationsRepository.listForUser(db, organization.id, creatorA.id, 10)).items).toHaveLength(0);
  });

  it("only: creator with null creatorUserId inserts 0", async () => {
    const { db, organization } = await setup();
    const count = await NotificationsRepository.fanOutWithTx(db, organization.id, await input(db, organization.id, "c"), { creatorUserId: null, only: "creator" });
    expect(count).toBe(0);
  });

  it("default (no only) is unchanged: OWNER, MANAGER, owning creator", async () => {
    const { db, organization, owner, manager, creatorA, creatorB } = await setup();
    const count = await NotificationsRepository.fanOutWithTx(db, organization.id, await input(db, organization.id, "d"), { creatorUserId: creatorA.id });
    expect(count).toBe(3);
    expect((await NotificationsRepository.listForUser(db, organization.id, owner.id, 10)).items).toHaveLength(1);
    expect((await NotificationsRepository.listForUser(db, organization.id, manager.id, 10)).items).toHaveLength(1);
    expect((await NotificationsRepository.listForUser(db, organization.id, creatorA.id, 10)).items).toHaveLength(1);
    expect((await NotificationsRepository.listForUser(db, organization.id, creatorB.id, 10)).items).toHaveLength(0);
  });
});
