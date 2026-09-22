import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users, organizationMembers } from "@/db/schema/organizations";
import { OrganizationMembersRepository } from "./organization-members.repository";

describe("OrganizationMembersRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("confirms membership for a user in an organization, and denies it for a non-member", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [otherOrg] = await db.insert(organizations).values({ name: "Other" }).returning();
    const [member] = await db
      .insert(users)
      .values({ email: "member@publyflow.test", fullName: "Member" })
      .returning();
    const [stranger] = await db
      .insert(users)
      .values({ email: "stranger@publyflow.test", fullName: "Stranger" })
      .returning();
    await db.insert(organizationMembers).values({ organizationId: org.id, userId: member.id, role: "OWNER" });
    await db.insert(organizationMembers).values({ organizationId: otherOrg.id, userId: stranger.id, role: "OWNER" });

    expect(await OrganizationMembersRepository.existsForOrganization(db, org.id, member.id)).toBe(true);
    expect(await OrganizationMembersRepository.existsForOrganization(db, org.id, stranger.id)).toBe(false);
  });
});
