import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

const post = (body: unknown) =>
  new Request("http://localhost/api/creators", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const valid = { fullName: "Thais Rocha", displayName: "Thais", email: "thais@publyflow.test", instagramHandle: "thais" };

describe("/api/creators", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(role: "OWNER" | "MANAGER" | "CREATOR" | null = "OWNER") {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const session = role ? { ...ownerSession(organization.id, owner.id), role } : null;
    const route = await importRouteWithSession(() => import("./route"), { db, session });
    return { db, organization, route };
  }

  it("401 without a session", async () => {
    const { route } = await setup(null);
    expect((await route.GET(new Request("http://localhost/api/creators"))).status).toBe(401);
    expect((await route.POST(post(valid))).status).toBe(401);
  });

  it("201 creates for OWNER and MANAGER", async () => {
    const { route } = await setup("MANAGER");
    const response = await route.POST(post(valid));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ displayName: "Thais", instagramHandle: "@thais" });
  });

  it("403 for CREATOR", async () => {
    const { route } = await setup("CREATOR");
    const response = await route.POST(post(valid));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Sem permissão." });
  });

  it("400 with field errors", async () => {
    const { route } = await setup();
    const response = await route.POST(post({ ...valid, email: "x@y", displayName: "" }));
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toMatchObject({
      email: ["Informe um e-mail válido."],
      displayName: ["Informe o nome de exibição."],
    });
  });

  it("409 when the e-mail already has a creator", async () => {
    const { route } = await setup();
    await route.POST(post(valid));
    const response = await route.POST(post(valid));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Já existe um creator com este e-mail." });
  });

  it("GET lists with e-mail, sorted", async () => {
    const { db, organization, route } = await setup();
    await CreatorService.register(db, organization.id, { ...valid, displayName: "Zoe", email: "zoe@publyflow.test", instagramHandle: null });
    await CreatorService.register(db, organization.id, { ...valid, displayName: "Ana", email: "ana@publyflow.test", instagramHandle: null });
    const list = await (await route.GET(new Request("http://localhost/api/creators"))).json();
    expect(list.map((c: { displayName: string; email: string }) => [c.displayName, c.email])).toEqual([
      ["Ana", "ana@publyflow.test"],
      ["Zoe", "zoe@publyflow.test"],
    ]);
  });

  it("does not return creators from another organization", async () => {
    const { db, route } = await setup();
    const other = await OrganizationService.createWithOwner(db, {
      organizationName: "Org B",
      ownerEmail: "owner-b@publyflow.test",
      ownerFullName: "Owner B",
    });
    await CreatorService.register(db, other.organization.id, valid);

    const response = await route.GET(new Request("http://localhost/api/creators"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
