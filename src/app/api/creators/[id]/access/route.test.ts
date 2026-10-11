import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

const ensureAuthUserMock = vi.hoisted(() => vi.fn(async (_email: string) => ({ authUserId: null as string | null, created: true })));
vi.mock("@/lib/auth/auth-admin", () => ({
  getAuthAdmin: () => ({ ensureAuthUser: ensureAuthUserMock, listAuthEmails: vi.fn() }),
}));

// Route modules are re-imported after vi.resetModules(), so the error class must be
// resolved at call time to be the same one the route checks with instanceof.
function failProvisioningOnce() {
  ensureAuthUserMock.mockImplementationOnce(async () => {
    const { AuthProvisioningError } = await import("@/lib/auth/errors");
    throw new AuthProvisioningError("x");
  });
}

const PROVISIONING_BODY = { error: "Não foi possível liberar o acesso agora. Tente novamente.", code: "AUTH_PROVISIONING_FAILED" };

describe("/api/creators/:id/access", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());
  beforeEach(() => {
    ensureAuthUserMock.mockReset().mockResolvedValue({ authUserId: null, created: true });
  });

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

  const post = (id: string) => new Request(`http://localhost/api/creators/${id}/access`, { method: "POST" });
  const del = (id: string) => new Request(`http://localhost/api/creators/${id}/access`, { method: "DELETE" });

  it("POST 200 invites for OWNER", async () => {
    const { db, organization, owner, creator } = await setup();
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await POST(post(creator.id), { params: Promise.resolve({ id: creator.id }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      loginUrl: "http://localhost/login",
      message:
        "Olá, Thais! Você foi convidado(a) para acompanhar suas propostas no PublyFlow. Acesse http://localhost/login e entre com Google ou com um link enviado para thais@publyflow.test.",
    });
  });

  it("POST 403 for CREATOR session", async () => {
    const { db, organization, creator } = await setup();
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    const response = await POST(post(creator.id), { params: Promise.resolve({ id: creator.id }) });
    expect(response.status).toBe(403);
  });

  it("POST 404 for a creator from another org", async () => {
    const { db, organization, owner } = await setup();
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
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await POST(post(foreignCreator.id), { params: Promise.resolve({ id: foreignCreator.id }) });
    expect(response.status).toBe(404);
  });

  it("POST 409 for the team case", async () => {
    const { db, organization, owner } = await setup();
    const teamCreator = await CreatorService.register(db, organization.id, {
      fullName: "Owner",
      displayName: "Owner as creator",
      email: "owner@publyflow.test",
      instagramHandle: null,
    });
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await POST(post(teamCreator.id), { params: Promise.resolve({ id: teamCreator.id }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Esta pessoa já faz parte da equipe." });
  });

  it("DELETE 204 revokes for OWNER", async () => {
    const { db, organization, owner, creator } = await setup();
    const { POST, DELETE } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });
    await POST(post(creator.id), { params: Promise.resolve({ id: creator.id }) });

    const response = await DELETE(del(creator.id), { params: Promise.resolve({ id: creator.id }) });
    expect(response.status).toBe(204);
  });

  it("DELETE 403 for CREATOR session", async () => {
    const { db, organization, creator } = await setup();
    const { DELETE } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    const response = await DELETE(del(creator.id), { params: Promise.resolve({ id: creator.id }) });
    expect(response.status).toBe(403);
  });

  it("409 with a retry message when invite or revoke hits a Postgres deadlock (40P01)", async () => {
    const { db, organization, owner, creator } = await setup();
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const { POST, DELETE } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
      extraMocks: () => {
        vi.doMock("@/services/creator-access.service", () => ({
          CreatorAccessService: { invite: vi.fn().mockRejectedValue(deadlock), revoke: vi.fn().mockRejectedValue(deadlock) },
        }));
      },
    });

    for (const response of [
      await POST(post(creator.id), { params: Promise.resolve({ id: creator.id }) }),
      await DELETE(del(creator.id), { params: Promise.resolve({ id: creator.id }) }),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Não foi possível salvar agora. Tente novamente." });
    }
  });

  it("POST 502 when provisioning the Supabase user fails; the invite stays committed", async () => {
    const { db, organization, owner, creator } = await setup();
    // The deadlock case above leaves a doMock of the service registered.
    vi.doUnmock("@/services/creator-access.service");
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });
    failProvisioningOnce();

    const response = await POST(post(creator.id), { params: Promise.resolve({ id: creator.id }) });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual(PROVISIONING_BODY);
  });
});
