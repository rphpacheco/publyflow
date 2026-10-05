import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { addAlias, seedMergePair, UNKNOWN_ID } from "@/test/helpers/merge-fixtures";

describe("DELETE /api/companies/:id/aliases/:aliasId", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(session: "owner" | "creator" | "none" = "owner") {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seed = await seedMergePair(db);
    const alias = await addAlias(db, seed.orgId, seed.duplicateCompanyId, "Bella Skin Ltda");
    const otherAlias = await addAlias(db, seed.orgId, seed.staysCompanyId, "Outro Apelido");
    const value =
      session === "owner"
        ? ownerSession(seed.orgId, seed.userId)
        : session === "creator"
          ? creatorSession(seed.orgId, seed.userId, seed.creatorId)
          : null;
    const { DELETE } = await importRouteWithSession(() => import("./route"), { db, session: value });
    const call = (id: string, aliasId: string) =>
      DELETE(new Request(`http://localhost/api/companies/${id}/aliases/${aliasId}`, { method: "DELETE" }), {
        params: Promise.resolve({ id, aliasId }),
      });
    return { call, companyId: seed.duplicateCompanyId, alias, otherAlias };
  }

  it("returns 401 without a session and 403 for a CREATOR", async () => {
    const none = await setup("none");
    expect((await none.call(none.companyId, none.alias.id)).status).toBe(401);
    await cleanup();
    const creator = await setup("creator");
    expect((await creator.call(creator.companyId, creator.alias.id)).status).toBe(403);
  });

  it("returns 204, then 404 on a repeat", async () => {
    const { call, companyId, alias } = await setup();
    const first = await call(companyId, alias.id);
    expect(first.status).toBe(204);
    const second = await call(companyId, alias.id);
    expect(second.status).toBe(404);
    expect(await second.json()).toEqual({ error: "Apelido não encontrado." });
  });

  it("returns 404 for another company's alias", async () => {
    const { call, companyId, otherAlias } = await setup();
    const response = await call(companyId, otherAlias.id);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Apelido não encontrado." });
  });

  it("returns 404 for malformed ids", async () => {
    const { call, companyId, alias } = await setup();
    const badCompany = await call("not-a-uuid", alias.id);
    expect(badCompany.status).toBe(404);
    expect(await badCompany.json()).toEqual({ error: "Empresa não encontrada." });
    const badAlias = await call(companyId, "not-a-uuid");
    expect(badAlias.status).toBe(404);
    expect(await badAlias.json()).toEqual({ error: "Apelido não encontrado." });
    const unknown = await call(UNKNOWN_ID, alias.id);
    expect(unknown.status).toBe(404);
  });
});
