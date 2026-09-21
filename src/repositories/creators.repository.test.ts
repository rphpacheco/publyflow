import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
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
});
