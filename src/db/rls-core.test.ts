import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { organizations, users, organizationMembers } from "./schema/organizations";
import { creators } from "./schema/creators";

describe("RLS on core tables", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns creators belonging to the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    // Setup writes go through the unrestricted `postgres` connection
    // (same as every other repository test) -- proving RLS isolation
    // only requires the *read* below to run as a non-superuser,
    // non-owner, non-BYPASSRLS role. See src/test/helpers/db.ts and
    // docker/test-db-init/01-app-user.sql.
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

    await db.insert(creators).values({
      organizationId: orgA.id,
      userId: userA.id,
      displayName: "Creator A",
    });
    await db.insert(creators).values({
      organizationId: orgB.id,
      userId: userB.id,
      displayName: "Creator B",
    });

    // Verification runs as `app_user` -- a role that is NOT a table
    // owner/superuser/BYPASSRLS, so Postgres actually enforces the RLS
    // policy instead of silently exempting the connection from it. The
    // SET LOCAL + SELECT are wrapped in one transaction so both
    // statements are guaranteed to run on the same physical connection
    // (a pooled connection isn't guaranteed to be reused across two
    // separate top-level queries, and SET LOCAL only survives to the
    // end of the transaction it was issued in).
    const appDb = getAppUserDb();
    const visible = await appDb.transaction(async (tx) => {
      // SET does not accept bind parameters, so app.current_org_id is
      // set via set_config(), which does.
      await tx.execute(sql`select set_config('app.current_org_id', ${orgA.id}, true)`);
      return tx.select().from(creators);
    });

    expect(visible).toHaveLength(1);
    expect(visible[0].displayName).toBe("Creator A");
  });
});
