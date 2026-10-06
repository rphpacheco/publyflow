import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { organizationMembers, users } from "@/db/schema/organizations";
import { provisionUser } from "./provision-user";
import type { AuthAdmin, EnsureAuthUserResult } from "./auth-admin";
import { AuthProvisioningError } from "./errors";

function fakeAdmin(result: EnsureAuthUserResult = { authUserId: "77777777-7777-4777-8777-777777777777", created: true }) {
  return {
    ensureAuthUser: vi.fn(async () => result),
    listAuthEmails: vi.fn(async () => new Set<string>()),
  } satisfies AuthAdmin;
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
    expect(result.createdAuthUser).toBe(true);
    expect(admin.ensureAuthUser).toHaveBeenCalledWith("raphael@publyflow.test", { password: "s3nha-forte" });
    const [user] = await db.select().from(users).where(eq(users.id, result.userId));
    expect(user.authUserId).toBe(result.authUserId);
  });

  it("creates and links the Supabase user even without a password", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const admin = fakeAdmin();

    const result = await provisionUser(db, admin, {
      email: "nopass@publyflow.test",
      fullName: "No Pass",
      role: "OWNER",
      organization: { newName: "Org" },
    });

    expect(admin.ensureAuthUser).toHaveBeenCalledWith("nopass@publyflow.test", { password: undefined });
    expect(result.createdAuthUser).toBe(true);
    const [user] = await db.select().from(users).where(eq(users.id, result.userId));
    expect(user.authUserId).toBe("77777777-7777-4777-8777-777777777777");
  });

  it("does not link when the e-mail already exists in Supabase", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const admin = fakeAdmin({ authUserId: null, created: false });

    const result = await provisionUser(db, admin, {
      email: "existing@publyflow.test",
      fullName: "Existing",
      role: "OWNER",
      organization: { newName: "Org" },
    });

    expect(result.authUserId).toBeNull();
    expect(result.createdAuthUser).toBe(false);
    const [user] = await db.select().from(users).where(eq(users.id, result.userId));
    expect(user.authUserId).toBeNull();
  });

  it("keeps DB rows committed and propagates when ensureAuthUser fails", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const admin = fakeAdmin();
    admin.ensureAuthUser.mockRejectedValueOnce(new AuthProvisioningError("unexpected_failure"));

    await expect(
      provisionUser(db, admin, {
        email: "fail@publyflow.test",
        fullName: "Fail",
        role: "OWNER",
        organization: { newName: "Org" },
      }),
    ).rejects.toBeInstanceOf(AuthProvisioningError);

    const rows = await db.select().from(users).where(eq(users.email, "fail@publyflow.test"));
    expect(rows).toHaveLength(1);
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
    expect(result.createdAuthUser).toBe(true);
    expect(result.authUserId).not.toBeNull();
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

  it("does not call ensureAuthUser when the user is already linked", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "linked@publyflow.test",
      ownerFullName: "Linked",
    });
    await db.update(users).set({ authUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }).where(eq(users.id, owner.id));
    const admin = fakeAdmin();

    const result = await provisionUser(db, admin, {
      email: "linked@publyflow.test",
      fullName: "Linked",
      role: "OWNER",
      organization: { id: organization.id },
    });

    expect(admin.ensureAuthUser).not.toHaveBeenCalled();
    expect(result.authUserId).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(result.createdAuthUser).toBe(false);
  });

  it("throws when the users row gets linked to a different auth user concurrently", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    // Simulate another process linking this row before ensureAuthUser resolves.
    const admin = fakeAdmin();
    admin.ensureAuthUser.mockImplementationOnce(async () => {
      await db.update(users).set({ authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }).where(eq(users.id, owner.id));
      return { authUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", created: true };
    });

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
