import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

describe("POST /api/inbox/messages", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the classification and a Commercial Inquiry for a commercial message", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.resetModules();
    vi.doMock("@/db", () => ({ db }));
    vi.doMock("@/lib/ai", () => ({
      ai: {
        classifyMessage: async () => ({
          category: "COMMERCIAL_LEAD",
          commercialScore: 94,
          intent: "Pedido de mídia kit",
          extracted: {
            companyName: "Bella Cosméticos",
            brandName: null,
            contactName: "Maria",
            email: null,
            phone: null,
            budget: null,
            deliverables: null,
          },
        }),
      },
    }));

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

    const request = new Request("http://localhost/api/inbox/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        creatorId: creator.id,
        source: "INSTAGRAM",
        externalContactLabel: "Maria — Bella Cosméticos",
        body: "Olá, gostaríamos de saber os valores para uma campanha.",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.classification.category).toBe("COMMERCIAL_LEAD");
    expect(json.inquiry).not.toBeNull();
  });
});
