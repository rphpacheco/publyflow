import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { CreatorAccessService } from "@/services/creator-access.service";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { users } from "@/db/schema/organizations";

const ensureAuthUserMock = vi.hoisted(() => vi.fn(async (_email: string) => ({ authUserId: null as string | null, created: true })));
vi.mock("@/lib/auth/auth-admin", () => ({
  getAuthAdmin: () => ({ ensureAuthUser: ensureAuthUserMock, listAuthEmails: vi.fn() }),
}));

const PROVISIONING_BODY = { error: "Não foi possível liberar o acesso agora. Tente novamente.", code: "AUTH_PROVISIONING_FAILED" };

const patch = (id: string, body: unknown) =>
  new Request(`http://localhost/api/creators/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/creators/[id]", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    // Per-test vi.doMock registrations must not leak into later tests.
    vi.doUnmock("@/services/creator.service");
    vi.resetModules();
    await cleanup?.();
  });
  beforeEach(() => {
    ensureAuthUserMock.mockReset().mockResolvedValue({ authUserId: null, created: true });
  });

  async function setup(role: "OWNER" | "CREATOR" = "OWNER") {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await OrganizationService.createWithOwner(db, { organizationName: "A", ownerEmail: "a@publyflow.test", ownerFullName: "A" });
    const b = await OrganizationService.createWithOwner(db, { organizationName: "B", ownerEmail: "b@publyflow.test", ownerFullName: "B" });
    const creator = await CreatorService.register(db, a.organization.id, {
      fullName: "Thais Rocha",
      displayName: "Thais",
      email: "thais@publyflow.test",
      instagramHandle: null,
    });
    const route = (session: ReturnType<typeof ownerSession>) => importRouteWithSession(() => import("./route"), { db, session });
    return { db, a, b, creator, route, role };
  }

  it("200 updates display fields, without an e-mail, as before", async () => {
    const { a, creator, route } = await setup();
    const { PATCH } = await route(ownerSession(a.organization.id, a.owner.id));
    const response = await PATCH(patch(creator.id, { displayName: "Thais R.", instagramHandle: "@thais.r" }), params(creator.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ displayName: "Thais R.", instagramHandle: "@thais.r", userId: creator.userId });
  });

  it("200 updates display fields and the e-mail when present", async () => {
    const { a, db, creator, route } = await setup();
    const { PATCH } = await route(ownerSession(a.organization.id, a.owner.id));
    const response = await PATCH(
      patch(creator.id, { displayName: "Thais R.", instagramHandle: "@thais.r", email: "novo@x.com" }),
      params(creator.id),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ displayName: "Thais R.", instagramHandle: "@thais.r", userId: creator.userId });
    const [user] = await db.select().from(users).where(eq(users.id, creator.userId));
    expect(user.email).toBe("novo@x.com");
  });

  it("409 with emailLocked once the creator has accessed the app", async () => {
    const { a, db, creator, route } = await setup();
    await CreatorAccessService.invite(db, a.organization.id, creator.id, "http://localhost");
    await OrganizationMembersRepository.recordLogin(db, a.organization.id, creator.userId, new Date());

    const { PATCH } = await route(ownerSession(a.organization.id, a.owner.id));
    const response = await PATCH(
      patch(creator.id, { displayName: "Thais", instagramHandle: null, email: "novo@x.com" }),
      params(creator.id),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Não é possível alterar o e-mail de quem já acessou o app." });
  });

  it("409 with a retry message when changeEmail hits a Postgres deadlock (40P01)", async () => {
    const { db, a, creator } = await setup();
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const { PATCH } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(a.organization.id, a.owner.id),
      extraMocks: () => {
        vi.doMock("@/services/creator.service", () => ({
          CreatorService: { changeEmail: vi.fn().mockRejectedValue(deadlock), update: vi.fn() },
        }));
      },
    });

    const response = await PATCH(
      patch(creator.id, { displayName: "Thais", instagramHandle: null, email: "novo@x.com" }),
      params(creator.id),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Não foi possível salvar agora. Tente novamente." });
  });

  // Covers the case-insensitive transfer path (findByEmail is case-insensitive, so the other
  // creator is found as target and findByUserIdWithTx rejects). The index itself is covered by
  // src/db/users-email-unique.test.ts.
  it("409 via the transfer path when the new e-mail differs only in case from another creator's e-mail in the same organization", async () => {
    const { a, db, creator, route } = await setup();
    await CreatorService.register(db, a.organization.id, {
      fullName: "Outra Pessoa",
      displayName: "Outra",
      email: "Outra@Publyflow.test",
      instagramHandle: null,
    });
    const { PATCH } = await route(ownerSession(a.organization.id, a.owner.id));
    const response = await PATCH(
      patch(creator.id, { displayName: "Thais", instagramHandle: null, email: "outra@publyflow.test" }),
      params(creator.id),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Já existe um creator com este e-mail." });
  });

  it("404 for another organization's creator", async () => {
    const { b, creator, route } = await setup();
    const { PATCH } = await route(ownerSession(b.organization.id, b.owner.id));
    const response = await PATCH(patch(creator.id, { displayName: "x", instagramHandle: null }), params(creator.id));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: `Creator ${creator.id} not found` });
  });

  it("403 for CREATOR and 400 with field errors", async () => {
    const { a, creator, route } = await setup();
    const asCreator = await route({ ...ownerSession(a.organization.id, a.owner.id), role: "CREATOR" });
    expect((await asCreator.PATCH(patch(creator.id, { displayName: "x", instagramHandle: null }), params(creator.id))).status).toBe(403);

    const asOwner = await route(ownerSession(a.organization.id, a.owner.id));
    const bad = await asOwner.PATCH(patch(creator.id, { displayName: "", instagramHandle: "a b" }), params(creator.id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).errors).toMatchObject({
      displayName: ["Informe o nome de exibição."],
      instagramHandle: ["Use só letras, números, ponto e sublinhado (até 30)."],
    });
  });

  it("502 when provisioning the new e-mail's Supabase user fails", async () => {
    const { a, db, creator, route } = await setup();
    await CreatorAccessService.invite(db, a.organization.id, creator.id, "http://localhost");
    const { PATCH } = await route(ownerSession(a.organization.id, a.owner.id));
    ensureAuthUserMock.mockImplementationOnce(async () => {
      // Resolved at call time: the route module was re-imported after vi.resetModules().
      const { AuthProvisioningError } = await import("@/lib/auth/errors");
      throw new AuthProvisioningError("x");
    });

    const response = await PATCH(
      patch(creator.id, { displayName: "Thais", instagramHandle: null, email: "novo@x.com" }),
      params(creator.id),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual(PROVISIONING_BODY);
  });

  it("retrying the same PATCH after a provisioning failure re-provisions and returns 200", async () => {
    const { a, db, creator, route } = await setup();
    await CreatorAccessService.invite(db, a.organization.id, creator.id, "http://localhost");
    const { PATCH } = await route(ownerSession(a.organization.id, a.owner.id));
    ensureAuthUserMock.mockClear();
    ensureAuthUserMock.mockImplementationOnce(async () => {
      const { AuthProvisioningError } = await import("@/lib/auth/errors");
      throw new AuthProvisioningError("x");
    });
    const body = { displayName: "Thais", instagramHandle: null, email: "novo@x.com" };

    const first = await PATCH(patch(creator.id, body), params(creator.id));
    expect(first.status).toBe(502);

    const second = await PATCH(patch(creator.id, body), params(creator.id));
    expect(second.status).toBe(200);
    expect(ensureAuthUserMock).toHaveBeenCalledTimes(2);
    expect(ensureAuthUserMock).toHaveBeenLastCalledWith("novo@x.com");
  });
});
