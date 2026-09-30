import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { organizationMembers, users } from "@/db/schema/organizations";
import { provisionUser, type AuthAdmin } from "./provision-user";

function fakeAdmin(id = "77777777-7777-4777-8777-777777777777"): AuthAdmin & { createUser: ReturnType<typeof vi.fn> } {
  return { createUser: vi.fn(async () => ({ id })) };
}

describe("provisionUser", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a new organization, user, OWNER membership and linked auth user", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const admin = fakeAdmin();

    const result = await provisionUser(db, admin, {
      email: "raphael@publyflow.test",
      fullName: "Raphael",
      role: "OWNER",
      organization: { newName: "PublyFlow Demo" },
      password: "s3nha-forte",
    });

    expect(result.createdUser).toBe(true);
    expect(result.createdMembership).toBe(true);
    expect(result.authUserId).toBe("77777777-7777-4777-8777-777777777777");
    expect(admin.createUser).toHaveBeenCalledWith({ email: "raphael@publyflow.test", password: "s3nha-forte" });
    const [user] = await db.select().from(users).where(eq(users.id, result.userId));
    expect(user.authUserId).toBe(result.authUserId);
  });

  it("reuses an existing users row (e.g. from onboardCreator) and adds the missing membership", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });
    const admin = fakeAdmin();

    const result = await provisionUser(db, admin, {
      email: "Thais@PublyFlow.test",
      fullName: "Thais",
      role: "MANAGER",
      organization: { id: organization.id },
    });

    expect(result.userId).toBe(creator.userId);
    expect(result.createdUser).toBe(false);
    expect(result.createdMembership).toBe(true);
    expect(result.authUserId).toBeNull();
    expect(admin.createUser).not.toHaveBeenCalled();
    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, creator.userId));
    expect(memberships.map((m) => m.role)).toEqual(["MANAGER"]);
  });

  it("is idempotent: a second run creates nothing new", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const admin = fakeAdmin();

    const result = await provisionUser(db, admin, {
      email: "owner@publyflow.test",
      fullName: "Owner",
      role: "OWNER",
      organization: { id: organization.id },
    });

    expect(result.createdUser).toBe(false);
    expect(result.createdMembership).toBe(false);
  });

  it("throws when the users row gets linked to a different auth user concurrently", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    // Simulate another process linking this row before admin.createUser resolves.
    const admin: AuthAdmin & { createUser: ReturnType<typeof vi.fn> } = {
      createUser: vi.fn(async () => {
        await db.update(users).set({ authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }).where(eq(users.id, owner.id));
        return { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
      }),
    };

    await expect(
      provisionUser(db, admin, {
        email: "owner@publyflow.test",
        fullName: "Owner",
        role: "OWNER",
        organization: { id: organization.id },
        password: "s3nha-forte",
      }),
    ).rejects.toThrow(/linked concurrently/);

    const [reloaded] = await db.select().from(users).where(eq(users.id, owner.id));
    expect(reloaded.authUserId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});
