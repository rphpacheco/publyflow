import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

describe("POST /api/services", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the created service", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const { POST } = await import("./route");

    const request = new Request("http://localhost/api/services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        creatorId: creator.id,
        name: "01 Reel",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.name).toBe("01 Reel");
    expect(json.isActive).toBe(true);
  });
});
