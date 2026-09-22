import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { CreatorsRepository } from "@/repositories/creators.repository";

describe("GET /api/creators", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the organization's creators, ordered by displayName", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [userA] = await db
      .insert(users)
      .values({ email: "zeca@publyflow.test", fullName: "Zeca" })
      .returning();
    const [userB] = await db
      .insert(users)
      .values({ email: "ana@publyflow.test", fullName: "Ana" })
      .returning();
    await CreatorsRepository.create(db, org.id, { userId: userA.id, displayName: "Zeca Silva" });
    await CreatorsRepository.create(db, org.id, { userId: userB.id, displayName: "Ana Costa" });

    const { GET } = await import("./route");

    const request = new Request(`http://localhost/api/creators?organizationId=${org.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.map((row: { displayName: string }) => row.displayName)).toEqual([
      "Ana Costa",
      "Zeca Silva",
    ]);
  });

  it("does not return creators from another organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [orgA] = await db.insert(organizations).values({ name: "Org A" }).returning();
    const [orgB] = await db.insert(organizations).values({ name: "Org B" }).returning();
    const [userB] = await db
      .insert(users)
      .values({ email: "creator-b@publyflow.test", fullName: "Creator B" })
      .returning();
    await CreatorsRepository.create(db, orgB.id, { userId: userB.id, displayName: "Creator B" });

    const { GET } = await import("./route");

    const request = new Request(`http://localhost/api/creators?organizationId=${orgA.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toEqual([]);
  });
});
