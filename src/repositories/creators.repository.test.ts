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
});
