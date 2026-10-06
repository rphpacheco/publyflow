import { describe, it, afterEach, expect } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";

describe("creators schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("links a creator to an organization and a user account", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais Miranda" })
      .returning();

    const [creator] = await db
      .insert(creators)
      .values({
        organizationId: org.id,
        userId: user.id,
        displayName: "Thais Miranda",
        instagramHandle: "thaimiranda",
      })
      .returning();

    expect(creator.organizationId).toBe(org.id);
    expect(creator.userId).toBe(user.id);
    expect(creator.instagramHandle).toBe("thaimiranda");
  });

  it("rejects a second creator for the same (organization, user) with unique violation 23505", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db.insert(users).values({ email: "dup@publyflow.test", fullName: "Dup" }).returning();
    await db.insert(creators).values({ organizationId: org.id, userId: user.id, displayName: "A" });

    const error = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "B" })
      .then(
        () => null,
        (e: { code?: string; cause?: { code?: string } }) => e,
      );
    expect(error?.code ?? error?.cause?.code).toBe("23505");

    const [otherOrg] = await db.insert(organizations).values({ name: "Other" }).returning();
    await expect(
      db.insert(creators).values({ organizationId: otherOrg.id, userId: user.id, displayName: "C" }),
    ).resolves.toBeDefined();
  });
});
