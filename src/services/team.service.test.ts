import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

const ensureAuthUser = vi.hoisted(() =>
  vi.fn(async (_email: string): Promise<{ authUserId: string | null; created: boolean }> => ({
    authUserId: "11111111-1111-4111-8111-111111111111",
    created: true,
  })),
);
vi.mock("@/lib/auth/auth-admin", () => ({ getAuthAdmin: () => ({ ensureAuthUser, listAuthEmails: vi.fn() }) }));

import { withTestDb } from "@/test/helpers/db";
import { ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { TeamService } from "./team.service";
import { TeamRepository } from "@/repositories/team.repository";
import { TeamConflictError, TeamMemberNotFoundError } from "@/domain/team/errors";
import { AuthProvisioningError } from "@/lib/auth/errors";
import { users, organizationMembers } from "@/db/schema/organizations";
import { domainEvents, notifications } from "@/db/schema/domain-events";
import { resolveSessionForAuthUser } from "@/lib/auth/resolve-session";
import { NotificationsRepository } from "@/repositories/notifications.repository";
import { runInTenantContext } from "@/repositories/tenant-context";

const ORIGIN = "http://localhost:3000";
const AUTH_ID = "11111111-1111-4111-8111-111111111111";

describe("TeamService", () => {
  let cleanup: () => Promise<void>;
  let db: Awaited<ReturnType<typeof withTestDb>>["db"];
  let organization: { id: string; name: string };
  let owner: { id: string };
  let session: ReturnType<typeof ownerSession>;

  beforeEach(async () => {
    ensureAuthUser.mockReset();
    ensureAuthUser.mockImplementation(async () => ({ authUserId: AUTH_ID, created: true }));
    const t = await withTestDb();
    db = t.db;
    cleanup = t.cleanup;
    const created = await OrganizationService.createWithOwner(db, {
      organizationName: "Agência X",
      ownerEmail: "owner@x.test",
      ownerFullName: "Olívia Dona",
    });
    organization = created.organization;
    owner = created.owner;
    session = ownerSession(organization.id, owner.id);
  });
  afterEach(async () => cleanup?.());

  const invitedEvents = () => db.select().from(domainEvents).where(eq(domainEvents.eventType, "member.invited"));
  const userRows = (email: string) => db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`);
  const managers = () => db.select().from(organizationMembers).where(eq(organizationMembers.role, "MANAGER"));

  describe("inviteManager", () => {
    it("invites a new e-mail as MANAGER, emits one event and links the new auth user", async () => {
      const result = await TeamService.inviteManager(db, session, { fullName: "Ana Lima", email: "ana@x.test" }, ORIGIN);

      expect(result.member).toMatchObject({ role: "MANAGER", status: "invited", isSelf: false, fullName: "Ana Lima", email: "ana@x.test" });
      expect(result.loginUrl).toBe("http://localhost:3000/login");
      expect(result.message).toBe(
        "Olá, Ana Lima! Você foi convidado(a) para a equipe da Agência X no PublyFlow. Acesse http://localhost:3000/login e entre com Google ou com um link enviado para ana@x.test.",
      );
      expect(await managers()).toHaveLength(1);
      const events = await invitedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({
        membershipId: result.member.id,
        userId: (await userRows("ana@x.test"))[0].id,
        invitedBy: owner.id,
      });
      expect(ensureAuthUser).toHaveBeenCalledTimes(1);
      expect(ensureAuthUser).toHaveBeenCalledWith("ana@x.test");
      const [user] = await userRows("ana@x.test");
      expect(user.authUserId).toBe(AUTH_ID);
    });

    it("reuses an existing user row matched case-insensitively and keeps its name", async () => {
      await db.insert(users).values({ email: "Ana@X.test", fullName: "Ana Antiga" });
      const result = await TeamService.inviteManager(db, session, { fullName: "Outro Nome", email: "ana@x.test" }, ORIGIN);

      const rows = await userRows("ana@x.test");
      expect(rows).toHaveLength(1);
      expect(rows[0].fullName).toBe("Ana Antiga");
      expect(result.member.fullName).toBe("Ana Antiga");
    });

    it("does not link when the auth user already existed", async () => {
      ensureAuthUser.mockResolvedValueOnce({ authUserId: null, created: false });
      const result = await TeamService.inviteManager(db, session, { fullName: "Ana Lima", email: "ana@x.test" }, ORIGIN);
      expect(result.member.role).toBe("MANAGER");
      const [user] = await userRows("ana@x.test");
      expect(user.authUserId).toBeNull();
    });

    it("never overwrites an existing auth_user_id", async () => {
      const existing = "22222222-2222-4222-8222-222222222222";
      await db.insert(users).values({ email: "ana@x.test", fullName: "Ana", authUserId: existing });
      await TeamService.inviteManager(db, session, { fullName: "Ana", email: "ana@x.test" }, ORIGIN);
      const [user] = await userRows("ana@x.test");
      expect(user.authUserId).toBe(existing);
    });

    it("is idempotent for an existing MANAGER: no new membership or event", async () => {
      await TeamService.inviteManager(db, session, { fullName: "Ana Lima", email: "ana@x.test" }, ORIGIN);
      const again = await TeamService.inviteManager(db, session, { fullName: "Ana Lima", email: "ana@x.test" }, ORIGIN);

      expect(again.member.role).toBe("MANAGER");
      expect(await managers()).toHaveLength(1);
      expect(await invitedEvents()).toHaveLength(1);
      expect(ensureAuthUser).toHaveBeenCalledTimes(2);
    });

    it("rejects an OWNER of this organization with ALREADY_IN_TEAM and writes nothing", async () => {
      await expect(
        TeamService.inviteManager(db, session, { fullName: "Olívia", email: "OWNER@x.test" }, ORIGIN),
      ).rejects.toMatchObject({ name: "TeamConflictError", code: "ALREADY_IN_TEAM" });
      expect(ensureAuthUser).not.toHaveBeenCalled();
      expect(await invitedEvents()).toHaveLength(0);
      expect(await db.select().from(organizationMembers)).toHaveLength(1);
    });

    it("rejects a creator of this organization (creators row, never invited) with IS_CREATOR", async () => {
      await CreatorService.onboardCreator(db, organization.id, {
        email: "thais@x.test",
        fullName: "Thais",
        displayName: "Thais",
      });
      await expect(
        TeamService.inviteManager(db, session, { fullName: "Thais", email: "thais@x.test" }, ORIGIN),
      ).rejects.toMatchObject({ code: "IS_CREATOR" });
      expect(ensureAuthUser).not.toHaveBeenCalled();
    });

    it("rejects a user with a CREATOR membership with IS_CREATOR", async () => {
      const [u] = await db.insert(users).values({ email: "cr@x.test", fullName: "Cr" }).returning();
      await db.insert(organizationMembers).values({ organizationId: organization.id, userId: u.id, role: "CREATOR" });
      await expect(
        TeamService.inviteManager(db, session, { fullName: "Cr", email: "cr@x.test" }, ORIGIN),
      ).rejects.toMatchObject({ code: "IS_CREATOR" });
    });

    it("rejects a user with access to another organization without leaking data", async () => {
      const other = await OrganizationService.createWithOwner(db, {
        organizationName: "Outra Org Secreta",
        ownerEmail: "boss@outra.test",
        ownerFullName: "Chefe Outro",
      });
      let caught: unknown;
      try {
        await TeamService.inviteManager(db, session, { fullName: "Chefe", email: "boss@outra.test" }, ORIGIN);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TeamConflictError);
      expect((caught as TeamConflictError).code).toBe("OTHER_ORGANIZATION");
      expect((caught as Error).message).toBe("Esse e-mail já tem acesso a outra organização.");
      expect(JSON.stringify(caught)).not.toContain(other.organization.name);
      expect(ensureAuthUser).not.toHaveBeenCalled();
    });

    it("rejects a creator of ANOTHER organization (never invited) with OTHER_ORGANIZATION and no data", async () => {
      const other = await OrganizationService.createWithOwner(db, {
        organizationName: "Outra Org Secreta",
        ownerEmail: "boss@outra.test",
        ownerFullName: "Chefe Outro",
      });
      await CreatorService.onboardCreator(db, other.organization.id, {
        email: "xcreator@outra.test",
        fullName: "Nome Secreto X",
        displayName: "X",
      });
      const membershipsBefore = await db.select().from(organizationMembers);
      let caught: unknown;
      try {
        await TeamService.inviteManager(db, session, { fullName: "X", email: "xcreator@outra.test" }, ORIGIN);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TeamConflictError);
      expect((caught as TeamConflictError).code).toBe("OTHER_ORGANIZATION");
      expect(JSON.stringify(caught)).not.toContain(other.organization.name);
      expect(JSON.stringify(caught)).not.toContain("Nome Secreto X");
      expect((caught as Error).message).not.toContain("Nome Secreto X");
      expect(await db.select().from(organizationMembers)).toHaveLength(membershipsBefore.length);
      expect(await invitedEvents()).toHaveLength(0);
      expect(ensureAuthUser).not.toHaveBeenCalled();
    });

    it("is idempotent for a MANAGER here even with a legacy membership in another organization", async () => {
      const other = await OrganizationService.createWithOwner(db, {
        organizationName: "Outra",
        ownerEmail: "boss@outra.test",
        ownerFullName: "Chefe",
      });
      const [u] = await db.insert(users).values({ email: "multi@x.test", fullName: "Multi" }).returning();
      await db.insert(organizationMembers).values([
        { organizationId: organization.id, userId: u.id, role: "MANAGER" },
        { organizationId: other.organization.id, userId: u.id, role: "MANAGER" },
      ]);
      const result = await TeamService.inviteManager(db, session, { fullName: "Multi", email: "multi@x.test" }, ORIGIN);
      expect(result.member.role).toBe("MANAGER");
      expect(await managers()).toHaveLength(2);
      expect(await invitedEvents()).toHaveLength(0);
      expect(ensureAuthUser).toHaveBeenCalledTimes(1);
    });

    it("retries once after a unique violation; a second one is ALREADY_IN_TEAM", async () => {
      const original = TeamRepository.upsertAndLockUserByEmailWithTx;
      const spy = vi.spyOn(TeamRepository, "upsertAndLockUserByEmailWithTx");
      spy.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
      const ok = await TeamService.inviteManager(db, session, { fullName: "Ana", email: "ana@x.test" }, ORIGIN);
      expect(ok.member.role).toBe("MANAGER");
      expect(spy).toHaveBeenCalledTimes(2);

      spy.mockReset();
      spy.mockImplementation(async () => {
        throw Object.assign(new Error("dup"), { code: "23505" });
      });
      await expect(
        TeamService.inviteManager(db, session, { fullName: "Bo", email: "bo@x.test" }, ORIGIN),
      ).rejects.toMatchObject({ name: "TeamConflictError", code: "ALREADY_IN_TEAM" });
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockImplementation(original);
      spy.mockRestore();
    });

    it("keeps the membership when provisioning fails and succeeds on retry", async () => {
      ensureAuthUser.mockRejectedValueOnce(new AuthProvisioningError("boom"));
      await expect(
        TeamService.inviteManager(db, session, { fullName: "Ana Lima", email: "ana@x.test" }, ORIGIN),
      ).rejects.toBeInstanceOf(AuthProvisioningError);
      expect(await managers()).toHaveLength(1);

      ensureAuthUser.mockResolvedValueOnce({ authUserId: null, created: false });
      const result = await TeamService.inviteManager(db, session, { fullName: "Ana Lima", email: "ana@x.test" }, ORIGIN);
      expect(result.member.role).toBe("MANAGER");
      const [user] = await userRows("ana@x.test");
      expect(user.authUserId).toBeNull();
    });

    it("handles two concurrent invites of the same e-mail (different case)", async () => {
      const results = await Promise.allSettled([
        TeamService.inviteManager(db, session, { fullName: "Bia", email: "Bia@X.test" }, ORIGIN),
        TeamService.inviteManager(db, session, { fullName: "Bia", email: "bia@x.test" }, ORIGIN),
      ]);
      for (const r of results) {
        if (r.status === "rejected") expect(r.reason).toBeInstanceOf(TeamConflictError);
      }
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      expect(await managers()).toHaveLength(1);
      expect(await invitedEvents()).toHaveLength(1);
    });
  });

  describe("list", () => {
    it("lists OWNER first then MANAGERs by name, excluding creators and other orgs, with isSelf and status", async () => {
      const [zed] = await db.insert(users).values({ email: "zed@x.test", fullName: "Zed" }).returning();
      const [abel] = await db.insert(users).values({ email: "abel@x.test", fullName: "abel" }).returning();
      await db.insert(organizationMembers).values({ organizationId: organization.id, userId: zed.id, role: "MANAGER" });
      await db
        .insert(organizationMembers)
        .values({ organizationId: organization.id, userId: abel.id, role: "MANAGER", firstLoginAt: new Date() });
      const [cr] = await db.insert(users).values({ email: "cr@x.test", fullName: "Cr" }).returning();
      await db.insert(organizationMembers).values({ organizationId: organization.id, userId: cr.id, role: "CREATOR" });
      await OrganizationService.createWithOwner(db, { organizationName: "Outra", ownerEmail: "o@outra.test", ownerFullName: "Outro" });

      const list = await TeamService.list(db, session);
      expect(list.map((m) => m.fullName)).toEqual(["Olívia Dona", "abel", "Zed"]);
      expect(list.map((m) => m.role)).toEqual(["OWNER", "MANAGER", "MANAGER"]);
      expect(list.map((m) => m.isSelf)).toEqual([true, false, false]);
      expect(list.map((m) => m.status)).toEqual(["invited", "active", "invited"]);

      const asAbel = await TeamService.list(db, { ...session, userId: abel.id, role: "MANAGER" });
      expect(asAbel.map((m) => m.isSelf)).toEqual([false, true, false]);
    });
  });

  describe("remind and remove", () => {
    const addManager = async (email = "ana@x.test", authUserId: string | null = null) => {
      const [u] = await db.insert(users).values({ email, fullName: "Ana Lima", authUserId }).returning();
      const [m] = await db
        .insert(organizationMembers)
        .values({ organizationId: organization.id, userId: u.id, role: "MANAGER" })
        .returning();
      return { user: u, membership: m };
    };
    const ownerMembershipId = async () =>
      (await db.select().from(organizationMembers).where(eq(organizationMembers.role, "OWNER")))[0].id;
    const removedEvents = () => db.select().from(domainEvents).where(eq(domainEvents.eventType, "member.removed"));

    it("remind: ensures the auth user and returns the exact message; links only when created", async () => {
      const { user, membership } = await addManager();
      const result = await TeamService.remind(db, session, membership.id, ORIGIN);
      expect(ensureAuthUser).toHaveBeenCalledWith("ana@x.test");
      expect(result.loginUrl).toBe("http://localhost:3000/login");
      expect(result.message).toBe(
        "Olá, Ana Lima! Você foi convidado(a) para a equipe da Agência X no PublyFlow. Acesse http://localhost:3000/login e entre com Google ou com um link enviado para ana@x.test.",
      );
      expect((await userRows(user.email))[0].authUserId).toBe(AUTH_ID);

      const second = await addManager("bo@x.test");
      ensureAuthUser.mockResolvedValueOnce({ authUserId: null, created: false });
      await TeamService.remind(db, session, second.membership.id, ORIGIN);
      expect((await userRows("bo@x.test"))[0].authUserId).toBeNull();
    });

    it("remind: OWNER target is NOT_A_MANAGER", async () => {
      await expect(TeamService.remind(db, session, await ownerMembershipId(), ORIGIN)).rejects.toMatchObject({
        name: "TeamConflictError",
        code: "NOT_A_MANAGER",
      });
      expect(ensureAuthUser).not.toHaveBeenCalled();
    });

    it("remind: unknown id, other org and CREATOR membership are not found", async () => {
      const other = await OrganizationService.createWithOwner(db, {
        organizationName: "Outra",
        ownerEmail: "boss@outra.test",
        ownerFullName: "Chefe",
      });
      const [otherMembership] = await db
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, other.organization.id));
      const [cr] = await db.insert(users).values({ email: "cr@x.test", fullName: "Cr" }).returning();
      const [crM] = await db
        .insert(organizationMembers)
        .values({ organizationId: organization.id, userId: cr.id, role: "CREATOR" })
        .returning();
      for (const id of ["33333333-3333-4333-8333-333333333333", otherMembership.id, crM.id]) {
        await expect(TeamService.remind(db, session, id, ORIGIN)).rejects.toBeInstanceOf(TeamMemberNotFoundError);
        await expect(TeamService.remove(db, session, id)).rejects.toBeInstanceOf(TeamMemberNotFoundError);
      }
      expect(ensureAuthUser).not.toHaveBeenCalled();
    });

    it("remind: provisioning failure surfaces AuthProvisioningError", async () => {
      const { membership } = await addManager();
      ensureAuthUser.mockRejectedValueOnce(new AuthProvisioningError("boom"));
      await expect(TeamService.remind(db, session, membership.id, ORIGIN)).rejects.toBeInstanceOf(AuthProvisioningError);
    });

    it("remove: deletes the membership, keeps user and notifications, emits one event", async () => {
      const { user, membership } = await addManager();
      await db.insert(notifications).values({ organizationId: organization.id, recipientUserId: user.id, kind: "k", title: "t" });
      await TeamService.remove(db, session, membership.id);

      expect(await managers()).toHaveLength(0);
      expect(await userRows(user.email)).toHaveLength(1);
      expect(await db.select().from(notifications).where(eq(notifications.recipientUserId, user.id))).toHaveLength(1);
      const events = await removedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].entityId).toBe(membership.id);
    });

    it("remove: OWNER target and self-removal are refused", async () => {
      await expect(TeamService.remove(db, session, await ownerMembershipId())).rejects.toMatchObject({ code: "CANNOT_REMOVE_OWNER" });
      const { user, membership } = await addManager();
      await expect(TeamService.remove(db, { ...session, userId: user.id }, membership.id)).rejects.toMatchObject({
        code: "CANNOT_REMOVE_SELF",
      });
      expect(await managers()).toHaveLength(1);
      expect(await removedEvents()).toHaveLength(0);
    });

    it("remove: revokes access effectively (session no longer resolves)", async () => {
      const { membership } = await addManager("ana@x.test", AUTH_ID);
      const identity = { id: AUTH_ID, email: "ana@x.test", emailVerified: true };
      expect(await resolveSessionForAuthUser(db, identity)).toMatchObject({ role: "MANAGER" });
      await TeamService.remove(db, session, membership.id);
      expect(await resolveSessionForAuthUser(db, identity)).toBeNull();
    });

    it("remove: staff fan-out after removal excludes the removed user", async () => {
      const { user, membership } = await addManager();
      await TeamService.remove(db, session, membership.id);
      const [event] = await removedEvents();
      await runInTenantContext(db, organization.id, (tx) =>
        NotificationsRepository.fanOutWithTx(
          tx,
          organization.id,
          { sourceEventId: event.id, kind: "k", title: "t", body: null, linkPath: null },
          { creatorUserId: null, only: "staff" },
        ),
      );
      const recipients = (await db.select().from(notifications).where(eq(notifications.sourceEventId, event.id))).map(
        (n) => n.recipientUserId,
      );
      expect(recipients).toEqual([owner.id]);
      expect(recipients).not.toContain(user.id);
    });
  });
});
