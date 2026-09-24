import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { organizations, organizationMembers, users } from "@/db/schema/organizations";
import { resolveSessionForAuthUser } from "./resolve-session";

const AUTH_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_AUTH_ID = "44444444-4444-4444-8444-444444444444";

describe("resolveSessionForAuthUser", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("resolves a user already linked by auth_user_id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    await db.update(users).set({ authUserId: AUTH_ID }).where(eq(users.id, owner.id));

    const session = await resolveSessionForAuthUser(db, { id: AUTH_ID, email: "whatever@x.test" });

    expect(session).toEqual({ userId: owner.id, organizationId: organization.id, role: "OWNER" });
  });

  it("links an unlinked user by e-mail (case-insensitive) on first login", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "Owner@PublyFlow.test",
      ownerFullName: "Owner",
    });

    const session = await resolveSessionForAuthUser(db, { id: AUTH_ID, email: "owner@publyflow.test" });

    expect(session).toEqual({ userId: owner.id, organizationId: organization.id, role: "OWNER" });
    const [reloaded] = await db.select().from(users).where(eq(users.id, owner.id));
    expect(reloaded.authUserId).toBe(AUTH_ID);
  });

  it("refuses an e-mail match whose user is already linked to another auth user", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    await db.update(users).set({ authUserId: OTHER_AUTH_ID }).where(eq(users.id, owner.id));

    const session = await resolveSessionForAuthUser(db, { id: AUTH_ID, email: "owner@publyflow.test" });

    expect(session).toBeNull();
    const [reloaded] = await db.select().from(users).where(eq(users.id, owner.id));
    expect(reloaded.authUserId).toBe(OTHER_AUTH_ID);
  });

  it("returns null and creates nothing for an unknown e-mail", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const session = await resolveSessionForAuthUser(db, { id: AUTH_ID, email: "stranger@x.test" });

    expect(session).toBeNull();
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("returns null when the auth user has no e-mail and no link", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    expect(await resolveSessionForAuthUser(db, { id: AUTH_ID, email: undefined })).toBeNull();
  });

  it("returns null for a user without any membership", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    // onboardCreator creates a users row but no organization_members row.
    await CreatorService.onboardCreator(db, organization.id, {
      email: "creator@publyflow.test",
      fullName: "Creator",
      displayName: "Creator",
    });

    const session = await resolveSessionForAuthUser(db, { id: AUTH_ID, email: "creator@publyflow.test" });

    expect(session).toBeNull();
  });

  it("uses the oldest membership when the user belongs to several organizations", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization: first, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Primeira",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const [second] = await db.insert(organizations).values({ name: "Segunda" }).returning();
    await db.insert(organizationMembers).values({
      organizationId: second.id,
      userId: owner.id,
      role: "MANAGER",
      createdAt: new Date(Date.now() + 60_000),
    });

    const session = await resolveSessionForAuthUser(db, { id: AUTH_ID, email: "owner@publyflow.test" });

    expect(session?.organizationId).toBe(first.id);
    expect(session?.role).toBe("OWNER");
  });
});
