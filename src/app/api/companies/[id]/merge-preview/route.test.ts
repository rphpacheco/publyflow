import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { seedMergePair, UNKNOWN_ID } from "@/test/helpers/merge-fixtures";

const NOT_FOUND = "Empresa não encontrada.";
const PICK = "Escolha a empresa que fica.";
const SAME = "Escolha outra empresa.";

describe("GET /api/companies/:id/merge-preview", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(session: "owner" | "creator" | "none" = "owner") {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seed = await seedMergePair(db);
    const value =
      session === "owner"
        ? ownerSession(seed.orgId, seed.userId)
        : session === "creator"
          ? creatorSession(seed.orgId, seed.userId, seed.creatorId)
          : null;
    const handlers = await importRouteWithSession(() => import("./route"), { db, session: value });
    const call = (id: string, into?: unknown) => {
      const query = into === undefined ? "" : `?into=${encodeURIComponent(String(into))}`;
      return handlers.GET(new Request(`http://localhost/api/companies/${id}/merge-preview${query}`), { params: Promise.resolve({ id }) });
    };
    return { db, seed, call, dup: seed.duplicateCompanyId, stays: seed.staysCompanyId };
  }

  it("returns 401 without a session", async () => {
    const { call, dup, stays } = await setup("none");
    expect((await call(dup, stays)).status).toBe(401);
  });

  it("returns 403 for a CREATOR", async () => {
    const { call, dup, stays } = await setup("creator");
    expect((await call(dup, stays)).status).toBe(403);
  });

  it("returns 404 for a malformed and an unknown id", async () => {
    const { call, stays } = await setup();
    for (const id of ["not-a-uuid", UNKNOWN_ID]) {
      const response = await call(id, stays);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: NOT_FOUND });
    }
  });

  it("returns 400 when into is missing or malformed", async () => {
    const { call, dup } = await setup();
    for (const into of [undefined, "not-a-uuid"]) {
      const response = await call(dup, into);
      expect(response.status).toBe(400);
      expect((await response.json()).errors.into).toEqual([PICK]);
    }
  });

  it("returns 404 for an unknown into", async () => {
    const { call, dup } = await setup();
    const response = await call(dup, UNKNOWN_ID);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: NOT_FOUND });
  });

  it("returns 422 SAME_RECORD when into equals the id", async () => {
    const { call, dup } = await setup();
    const response = await call(dup, dup);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: SAME, code: "SAME_RECORD" });
  });

  it("returns 200 with the preview", async () => {
    const { call, dup, stays } = await setup();
    const response = await call(dup, stays);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.duplicate).toEqual({ id: dup, name: "Bella Cosméticos" });
    expect(json.stays).toEqual({ id: stays, name: "Bella Cosmeticos Ltda" });
    expect(json.result).toEqual({ name: "Bella Cosmeticos Ltda" });
    expect(json.impact).toEqual(expect.objectContaining({ brands: 0 }));
    expect(json.aliasToAdd).toBe("Bella Cosméticos");
  });
});
