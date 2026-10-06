import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { seedMergePair, UNKNOWN_ID } from "@/test/helpers/merge-fixtures";
import { contacts as table } from "@/db/schema/companies-brands-contacts";

const NOT_FOUND = "Contato não encontrado.";
const PICK = "Escolha o contato que fica.";
const SAME = "Escolha outro contato.";

describe("POST /api/contacts/:id/merge", () => {
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
      return handlers.POST(
        new Request(`http://localhost/api/contacts/${id}/merge`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(into === undefined ? {} : { into }),
        }),
        { params: Promise.resolve({ id }) },
      );
    };
    return { db, seed, call, dup: seed.duplicateContactId, stays: seed.staysContactId };
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

  it("returns 200 with the surviving contact and removes the duplicate", async () => {
    const { db, call, dup, stays } = await setup();
    const response = await call(dup, stays);
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe(stays);
    const remaining = (await db.select().from(table)).map((r) => r.id);
    expect(remaining).toContain(stays);
    expect(remaining).not.toContain(dup);
  });
});
