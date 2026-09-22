import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { organizations, users } from "./schema/organizations";
import { creators } from "./schema/creators";
import { rateCards } from "./schema/rate-cards";

describe("RLS on rate_cards", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns rate cards belonging to the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [orgA] = await db.insert(organizations).values({ name: "Org A" }).returning();
    const [orgB] = await db.insert(organizations).values({ name: "Org B" }).returning();
    const [userA] = await db
      .insert(users)
      .values({ email: "a@publyflow.test", fullName: "User A" })
      .returning();
    const [userB] = await db
      .insert(users)
      .values({ email: "b@publyflow.test", fullName: "User B" })
      .returning();
    const [creatorA] = await db
      .insert(creators)
      .values({ organizationId: orgA.id, userId: userA.id, displayName: "Creator A" })
      .returning();
    const [creatorB] = await db
      .insert(creators)
      .values({ organizationId: orgB.id, userId: userB.id, displayName: "Creator B" })
      .returning();

    await db.insert(rateCards).values({
      organizationId: orgA.id,
      creatorId: creatorA.id,
      name: "Tabela A",
    });
    await db.insert(rateCards).values({
      organizationId: orgB.id,
      creatorId: creatorB.id,
      name: "Tabela B",
    });

    const appDb = getAppUserDb();
    const visible = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${orgA.id}, true)`);
      return tx.select().from(rateCards);
    });

    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe("Tabela A");
  });
});
