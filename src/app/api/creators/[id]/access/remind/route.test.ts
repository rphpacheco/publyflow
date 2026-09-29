import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { CreatorAccessService } from "@/services/creator-access.service";

describe("/api/creators/:id/access/remind", () => {
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
});
