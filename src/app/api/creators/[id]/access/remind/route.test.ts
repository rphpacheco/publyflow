import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { CreatorAccessService } from "@/services/creator-access.service";

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

describe("/api/creators/:id/access/remind", () => {
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

  const post = (id: string) => new Request(`http://localhost/api/creators/${id}/access/remind`, { method: "POST" });

  it("200 with instructions for OWNER, once invited", async () => {
    const { db, organization, owner, creator } = await setup();
    await CreatorAccessService.invite(db, organization.id, creator.id, "http://localhost");
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await POST(post(creator.id), { params: Promise.resolve({ id: creator.id }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      loginUrl: "http://localhost/login",
      message:
        "Olá, Thais! Você foi convidado(a) para acompanhar suas propostas no PublyFlow. Acesse http://localhost/login e entre com Google ou com um link enviado para thais@publyflow.test.",
    });
  });

  it("403 for CREATOR session", async () => {
    const { db, organization, creator } = await setup();
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    const response = await POST(post(creator.id), { params: Promise.resolve({ id: creator.id }) });
    expect(response.status).toBe(403);
  });

  it("404 for another org's creator", async () => {
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

  it("409 not invited yet", async () => {
    const { db, organization, owner, creator } = await setup();
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await POST(post(creator.id), { params: Promise.resolve({ id: creator.id }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Este creator ainda não foi convidado." });
  });

  it("502 when provisioning the Supabase user fails", async () => {
    const { db, organization, owner, creator } = await setup();
    await CreatorAccessService.invite(db, organization.id, creator.id, "http://localhost");
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });
    failProvisioningOnce();

    const response = await POST(post(creator.id), { params: Promise.resolve({ id: creator.id }) });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual(PROVISIONING_BODY);
  });
});
