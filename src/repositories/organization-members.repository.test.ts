import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
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

describe("OrganizationMembersRepository.recordLogin", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("sets first_login_at once and last_login_at every time", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const first = new Date("2026-09-29T10:00:00Z");
    const second = new Date("2026-09-30T11:00:00Z");

    await OrganizationMembersRepository.recordLogin(db, organization.id, owner.id, first);
    await OrganizationMembersRepository.recordLogin(db, organization.id, owner.id, second);

    const [member] = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organization.id), eq(organizationMembers.userId, owner.id)));
    expect(member.firstLoginAt?.toISOString()).toBe(first.toISOString());
    expect(member.lastLoginAt?.toISOString()).toBe(second.toISOString());
  });
});
