import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { CreatorAccessService } from "@/services/creator-access.service";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { users } from "@/db/schema/organizations";

const patch = (id: string, body: unknown) =>
  new Request(`http://localhost/api/creators/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/creators/[id]", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

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
});
