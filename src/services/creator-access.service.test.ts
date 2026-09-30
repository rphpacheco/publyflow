import { describe, it, expect, afterEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { CreatorAccessService } from "./creator-access.service";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { resolveSessionForAuthUser } from "@/lib/auth/resolve-session";
import { CreatorNotFoundError, CreatorAccessConflictError, ACCESS_ERRORS } from "@/domain/creators/errors";
import { users, organizationMembers } from "@/db/schema/organizations";

const AUTH_ID = "33333333-3333-4333-8333-333333333333";

describe("CreatorAccessService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.register(db, organization.id, {
      fullName: "Thais Rocha",
      displayName: "Thais",
      email: "thais@publyflow.test",
      instagramHandle: null,
    });
    return { db, organization, owner, creator };
  }

  describe("invite", () => {
    it("creates exactly one CREATOR membership; a second invite doesn't duplicate it", async () => {
      const { db, organization, creator } = await setup();

      const result = await CreatorAccessService.invite(db, organization.id, creator.id, "http://localhost");
      expect(result).toEqual({
        loginUrl: "http://localhost/login",
        message:
          "Olá, Thais! Você foi convidado(a) para acompanhar suas propostas no PublyFlow. Acesse http://localhost/login e entre com Google ou com um link enviado para thais@publyflow.test.",
      });

      await CreatorAccessService.invite(db, organization.id, creator.id, "http://localhost");

      const memberships = await db
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, creator.userId));
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe("CREATOR");
    });

    it("throws otherOrganization when the creator's user belongs to another org", async () => {
      const { db, organization, creator } = await setup();
      const other = await OrganizationService.createWithOwner(db, {
        organizationName: "Org B",
        ownerEmail: "owner-b@publyflow.test",
        ownerFullName: "Owner B",
      });
      await db.insert(organizationMembers).values({ organizationId: other.organization.id, userId: creator.userId, role: "CREATOR" });

      await expect(CreatorAccessService.invite(db, organization.id, creator.id, "http://localhost")).rejects.toThrow(
        CreatorAccessConflictError,
      );
      await expect(CreatorAccessService.invite(db, organization.id, creator.id, "http://localhost")).rejects.toThrow(
        ACCESS_ERRORS.otherOrganization,
      );
    });

    it("throws team when the creator is registered with the owner's e-mail", async () => {
      const { db, organization, owner } = await setup();
      const teamCreator = await CreatorService.register(db, organization.id, {
        fullName: "Owner",
        displayName: "Owner as creator",
        email: "owner@publyflow.test",
        instagramHandle: null,
      });
      expect(teamCreator.userId).toBe(owner.id);

      await expect(CreatorAccessService.invite(db, organization.id, teamCreator.id, "http://localhost")).rejects.toThrow(
        ACCESS_ERRORS.team,
      );
    });

    it("throws CreatorNotFoundError for a creator from another org", async () => {
      const { db, organization } = await setup();
      const other = await OrganizationService.createWithOwner(db, {
        organizationName: "Org B",
        ownerEmail: "owner-b@publyflow.test",
        ownerFullName: "Owner B",
      });
      const foreignCreator = await CreatorService.register(db, other.organization.id, {
        fullName: "Zoe",
        displayName: "Zoe",
        email: "zoe@publyflow.test",
        instagramHandle: null,
      });

      await expect(CreatorAccessService.invite(db, organization.id, foreignCreator.id, "http://localhost")).rejects.toThrow(
        CreatorNotFoundError,
      );
    });

    it("serializes two concurrent invites for the same user across orgs (F1): only one succeeds, the other gets otherOrganization", async () => {
      const { db, organization } = await setup();
      const other = await OrganizationService.createWithOwner(db, {
        organizationName: "Org B",
        ownerEmail: "owner-b@publyflow.test",
        ownerFullName: "Owner B",
      });
      // Same e-mail reused across both orgs (like register does for an
      // existing `users` row), so both invites share one `users` row.
      const creatorA = await CreatorService.register(db, organization.id, {
        fullName: "Shared",
        displayName: "Shared A",
        email: "shared@publyflow.test",
        instagramHandle: null,
      });
      const creatorB = await CreatorService.register(db, other.organization.id, {
        fullName: "Shared",
        displayName: "Shared B",
        email: "shared@publyflow.test",
        instagramHandle: null,
      });
      expect(creatorB.userId).toBe(creatorA.userId);

      // Hold a lock on the shared user's row in a separate transaction to
      // simulate invite A getting there first, then insert the org A
      // membership it would produce, before releasing the lock that
      // invite B's loadLockedCreator is blocked on.
      let signalLockAcquired: () => void = () => {};
      const lockAcquired = new Promise<void>((resolve) => {
        signalLockAcquired = resolve;
      });
      let releaseHeldTx: () => void = () => {};
      const releaseSignal = new Promise<void>((resolve) => {
        releaseHeldTx = resolve;
      });

      const holdingTx = db.transaction(async (tx) => {
        await tx.execute(sql`select id from ${users} where id = ${creatorA.userId} for update`);
        signalLockAcquired();
        await releaseSignal;
        await tx.insert(organizationMembers).values({ organizationId: organization.id, userId: creatorA.userId, role: "CREATOR" });
      });

      await lockAcquired;

      const inviteBPromise = CreatorAccessService.invite(db, other.organization.id, creatorB.id, "http://localhost");

      // Give invite B time to reach (and block on) the lock before we
      // release it -- otherwise the assertion below races invite B itself
      // instead of proving it waited for the held lock.
      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseHeldTx();
      await holdingTx;

      await expect(inviteBPromise).rejects.toThrow(ACCESS_ERRORS.otherOrganization);

      const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.userId, creatorA.userId));
      expect(memberships).toHaveLength(1);
      expect(memberships[0].organizationId).toBe(organization.id);
    });
  });

  describe("revoke", () => {
    it("removes the CREATOR membership; resolveSessionForAuthUser then returns null", async () => {
      const { db, organization, creator } = await setup();
      await CreatorAccessService.invite(db, organization.id, creator.id, "http://localhost");
      await db.update(users).set({ authUserId: AUTH_ID }).where(eq(users.id, creator.userId));
      const before = await resolveSessionForAuthUser(db, { id: AUTH_ID, email: "thais@publyflow.test", emailVerified: true });
      expect(before).not.toBeNull();

      await CreatorAccessService.revoke(db, organization.id, creator.id);

      const after = await resolveSessionForAuthUser(db, { id: AUTH_ID, email: "thais@publyflow.test", emailVerified: true });
      expect(after).toBeNull();
    });

    it("throws team and keeps the OWNER membership", async () => {
      const { db, organization, owner } = await setup();
      const teamCreator = await CreatorService.register(db, organization.id, {
        fullName: "Owner",
        displayName: "Owner as creator",
        email: "owner@publyflow.test",
        instagramHandle: null,
      });

      await expect(CreatorAccessService.revoke(db, organization.id, teamCreator.id)).rejects.toThrow(ACCESS_ERRORS.team);

      const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.userId, owner.id));
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe("OWNER");
    });

    it("throws CreatorNotFoundError for a creator from another org", async () => {
      const { db, organization } = await setup();
      const other = await OrganizationService.createWithOwner(db, {
        organizationName: "Org B",
        ownerEmail: "owner-b@publyflow.test",
        ownerFullName: "Owner B",
      });
      const foreignCreator = await CreatorService.register(db, other.organization.id, {
        fullName: "Zoe",
        displayName: "Zoe",
        email: "zoe@publyflow.test",
        instagramHandle: null,
      });

      await expect(CreatorAccessService.revoke(db, organization.id, foreignCreator.id)).rejects.toThrow(CreatorNotFoundError);
    });

    it("revokes the membership of the creator's CURRENT user after a changeEmail transfer (F1)", async () => {
      const { db, organization, creator } = await setup();
      await CreatorAccessService.invite(db, organization.id, creator.id, "http://localhost");
      const oldUserId = creator.userId;

      const [targetUser] = await db.insert(users).values({ email: "target@publyflow.test", fullName: "Target" }).returning();
      await CreatorService.changeEmail(db, organization.id, creator.id, "target@publyflow.test");

      await CreatorAccessService.revoke(db, organization.id, creator.id);

      const targetMemberships = await db
        .select()
        .from(organizationMembers)
        .where(and(eq(organizationMembers.userId, targetUser.id), eq(organizationMembers.role, "CREATOR")));
      expect(targetMemberships).toHaveLength(0);

      const oldUserMemberships = await db.select().from(organizationMembers).where(eq(organizationMembers.userId, oldUserId));
      expect(oldUserMemberships).toHaveLength(0);
    });
  });

  describe("remind", () => {
    it("returns instructions once invited; throws notInvited before that", async () => {
      const { db, organization, creator } = await setup();

      await expect(CreatorAccessService.remind(db, organization.id, creator.id, "http://localhost")).rejects.toThrow(
        ACCESS_ERRORS.notInvited,
      );

      await CreatorAccessService.invite(db, organization.id, creator.id, "http://localhost");
      const result = await CreatorAccessService.remind(db, organization.id, creator.id, "http://localhost");
      expect(result.loginUrl).toBe("http://localhost/login");
    });

    it("throws CreatorNotFoundError for a creator from another org", async () => {
      const { db, organization } = await setup();
      const other = await OrganizationService.createWithOwner(db, {
        organizationName: "Org B",
        ownerEmail: "owner-b@publyflow.test",
        ownerFullName: "Owner B",
      });
      const foreignCreator = await CreatorService.register(db, other.organization.id, {
        fullName: "Zoe",
        displayName: "Zoe",
        email: "zoe@publyflow.test",
        instagramHandle: null,
      });

      await expect(CreatorAccessService.remind(db, organization.id, foreignCreator.id, "http://localhost")).rejects.toThrow(
        CreatorNotFoundError,
      );
    });
  });

  describe("listWithAccess", () => {
    it("none / invited / active / team, with lastLoginAt and emailEditable", async () => {
      const { db, organization, owner, creator: noneCreator } = await setup();

      const invitedCreator = await CreatorService.register(db, organization.id, {
        fullName: "Invited",
        displayName: "Invited",
        email: "invited@publyflow.test",
        instagramHandle: null,
      });
      await CreatorAccessService.invite(db, organization.id, invitedCreator.id, "http://localhost");

      const activeCreator = await CreatorService.register(db, organization.id, {
        fullName: "Active",
        displayName: "Active",
        email: "active@publyflow.test",
        instagramHandle: null,
      });
      await CreatorAccessService.invite(db, organization.id, activeCreator.id, "http://localhost");
      const loginTime = new Date();
      await OrganizationMembersRepository.recordLogin(db, organization.id, activeCreator.userId, loginTime);

      const teamCreator = await CreatorService.register(db, organization.id, {
        fullName: "Owner",
        displayName: "Owner as creator",
        email: "owner@publyflow.test",
        instagramHandle: null,
      });

      const list = await CreatorService.listWithAccess(db, organization.id);
      const byName = Object.fromEntries(list.map((c) => [c.displayName, c]));

      expect(byName["Thais"].access).toBe("none");
      expect(byName["Thais"].emailEditable).toBe(true);
      expect(byName["Thais"].lastLoginAt).toBeNull();

      expect(byName["Invited"].access).toBe("invited");
      expect(byName["Invited"].emailEditable).toBe(true);

      expect(byName["Active"].access).toBe("active");
      expect(byName["Active"].emailEditable).toBe(false);
      expect(byName["Active"].lastLoginAt).toEqual(loginTime);

      expect(byName["Owner as creator"].access).toBe("team");
      expect(byName["Owner as creator"].emailEditable).toBe(false);

      // Never-invited, never-linked -- id kept so linting doesn't flag unused var.
      expect(noneCreator.id).toBeTruthy();
      expect(owner.id).toBeTruthy();
    });

    it("emailEditable is false once auth_user_id is set", async () => {
      const { db, organization, creator } = await setup();
      await db.update(users).set({ authUserId: AUTH_ID }).where(eq(users.id, creator.userId));

      const list = await CreatorService.listWithAccess(db, organization.id);
      const row = list.find((c) => c.id === creator.id)!;
      expect(row.emailEditable).toBe(false);
    });
  });
});
