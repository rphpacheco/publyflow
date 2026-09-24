import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

describe("POST /api/rate-cards", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the created rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const request = new Request("http://localhost/api/rate-cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        creatorId: creator.id,
        name: "Tabela 2026",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.name).toBe("Tabela 2026");
    expect(json.isLocked).toBe(false);
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const request = new Request("http://localhost/api/rate-cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creatorId: "00000000-0000-0000-0000-000000000000", name: "Tabela 2026" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});

describe("GET /api/rate-cards", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const request = new Request(
      "http://localhost/api/rate-cards?creatorId=00000000-0000-0000-0000-000000000000",
    );

    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});
