import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { CreatorsRepository } from "./creators.repository";

describe("CreatorsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a creator scoped to the tenant and lists only that tenant's creators", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [orgA] = await db.insert(organizations).values({ name: "Org A" }).returning();
    const [orgB] = await db.insert(organizations).values({ name: "Org B" }).returning();
    const [userA] = await db
      .insert(users)
      .values({ email: "a@publyflow.test", fullName: "User A" })
      .returning();

    await CreatorsRepository.create(db, orgA.id, {
      userId: userA.id,
      displayName: "Thais Miranda",
      instagramHandle: "thaimiranda",
    });

    const orgAResults = await CreatorsRepository.listByOrganization(db, orgA.id);
    const orgBResults = await CreatorsRepository.listByOrganization(db, orgB.id);

    expect(orgAResults).toHaveLength(1);
    expect(orgAResults[0].displayName).toBe("Thais Miranda");
    expect(orgBResults).toHaveLength(0);
  });

  it("confirms a creator belongs to an organization, and denies a creator from another organization or a nonexistent id", async () => {
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

    expect(await CreatorsRepository.existsForOrganization(db, orgA.id, creatorA.id)).toBe(true);
    expect(await CreatorsRepository.existsForOrganization(db, orgA.id, creatorB.id)).toBe(false);
    expect(
      await CreatorsRepository.existsForOrganization(db, orgA.id, "00000000-0000-0000-0000-000000000000"),
    ).toBe(false);
  });

  it("lists creators ordered deterministically by displayName", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [userA] = await db
      .insert(users)
      .values({ email: "zeca@publyflow.test", fullName: "Zeca" })
      .returning();
    const [userB] = await db
      .insert(users)
      .values({ email: "ana@publyflow.test", fullName: "Ana" })
      .returning();

    // Insert "Zeca Silva" first and "Ana Costa" second, so creation order is
    // the reverse of alphabetical order — proves the ordering is on
    // displayName, not insertion order.
    await CreatorsRepository.create(db, org.id, { userId: userA.id, displayName: "Zeca Silva" });
    await CreatorsRepository.create(db, org.id, { userId: userB.id, displayName: "Ana Costa" });

    const list = await CreatorsRepository.listByOrganization(db, org.id);

    expect(list.map((c) => c.displayName)).toEqual(["Ana Costa", "Zeca Silva"]);
  });

  it("returns an empty list for an organization with no creators", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Empty Org" }).returning();

    const list = await CreatorsRepository.listByOrganization(db, org.id);

    expect(list).toEqual([]);
  });
});
