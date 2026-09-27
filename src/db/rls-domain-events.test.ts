import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { domainEvents, notifications } from "./schema/domain-events";

describe("RLS on domain_events and notifications", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns rows of the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    for (const seeded of [a, b]) {
      const [event] = await db
        .insert(domainEvents)
        .values({ organizationId: seeded.organization.id, eventType: "proposal.sent", entityType: "proposal", entityId: seeded.proposal.id })
        .returning();
      await db.insert(notifications).values({
        organizationId: seeded.organization.id,
        recipientUserId: seeded.owner.id,
        kind: "proposal.sent",
        title: "x",
        sourceEventId: event.id,
      });
    }

    const visible = await getAppUserDb().transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${a.organization.id}, true)`);
      return { events: await tx.select().from(domainEvents), notes: await tx.select().from(notifications) };
    });
    expect(visible.events.map((row) => row.organizationId)).toEqual([a.organization.id]);
    expect(visible.notes.map((row) => row.organizationId)).toEqual([a.organization.id]);
  });
});
