import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

describe("/api/creators/:id/access", () => {
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
});
