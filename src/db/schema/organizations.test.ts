import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users, organizationMembers } from "./organizations";

describe("organizations schema", () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    await cleanup?.();
  });

  it("inserts an organization, a user, and a membership with a role", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db
      .insert(organizations)
      .values({ name: "Thais Miranda Management" })
      .returning();

    const [user] = await db
      .insert(users)
      .values({ email: "assessora@publyflow.test", fullName: "Assessora Comercial" })
      .returning();

    const [member] = await db
      .insert(organizationMembers)
      .values({ organizationId: org.id, userId: user.id, role: "MANAGER" })
      .returning();

    expect(member.organizationId).toBe(org.id);
    expect(member.userId).toBe(user.id);
    expect(member.role).toBe("MANAGER");
  });

  it("rejects duplicate membership for the same user in the same organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "dup@publyflow.test", fullName: "Dup User" })
      .returning();

    await db
      .insert(organizationMembers)
      .values({ organizationId: org.id, userId: user.id, role: "OWNER" });

    await expect(
      db.insert(organizationMembers).values({
        organizationId: org.id,
        userId: user.id,
        role: "MANAGER",
      }),
    ).rejects.toThrow();
  });
});
