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
import { TeamConflictError } from "@/domain/team/errors";
import { AuthProvisioningError } from "@/lib/auth/errors";
import { users, organizationMembers } from "@/db/schema/organizations";
import { domainEvents } from "@/db/schema/domain-events";

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
      expect(await invitedEvents()).toHaveLength(1);
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
});
