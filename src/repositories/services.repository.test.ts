import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { ServicesRepository } from "./services.repository";

describe("ServicesRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a service, updates it, and lists only the creator's active+inactive services", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();

    const created = await ServicesRepository.create(db, org.id, {
      creatorId: creator.id,
      name: "01 Reel",
      description: "Reel patrocinado",
    });

    expect(created.name).toBe("01 Reel");

    const updated = await ServicesRepository.update(db, org.id, created.id, {
      isActive: false,
    });

    expect(updated.isActive).toBe(false);

    const list = await ServicesRepository.listByCreator(db, org.id, creator.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });

  it("createWithTx inserts a service inside a caller-supplied transaction", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();

    const service = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${org.id}, true)`);
      return ServicesRepository.createWithTx(tx, org.id, { creatorId: creator.id, name: "01 Reel" });
    });

    expect(service.name).toBe("01 Reel");
  });
});
