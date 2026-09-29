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
    NotificationsRepository.fanOutWithTx(
      tx,
      seeded.organization.id,
      {
        sourceEventId: event.id,
        kind: "proposal.approved",
        title: "Proposta aceita",
        body: 'Maria aceitou "Campanha Verão".',
        linkPath: `/proposals/${seeded.proposal.id}`,
      },
      { creatorUserId: null },
    ),
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
