import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { InboxService } from "@/services/inbox.service";

function fakeAI() {
  return {
    classifyMessage: async () => ({
      category: "COMMERCIAL_LEAD" as const,
      commercialScore: 90,
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
  };
}

describe("GET /api/commercial-inquiries", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the creator's inquiries", async () => {
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

    await InboxService.ingestManualMessage(db, fakeAI(), organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores.",
      receivedAt: new Date(),
    });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const request = new Request(
      `http://localhost/api/commercial-inquiries?creatorId=${creator.id}`,
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.length).toBe(1);
    expect(json[0].companyGuess).toBe("Bella Cosméticos");
    expect(json[0].messageBody).toBe("Olá, gostaríamos de saber os valores.");
    expect(json[0].externalContactLabel).toBe("Maria — Bella Cosméticos");
    expect(json[0].source).toBe("INSTAGRAM");
    expect(typeof json[0].conversationId).toBe("string");
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const request = new Request(
      `http://localhost/api/commercial-inquiries?creatorId=00000000-0000-0000-0000-000000000000`,
    );
    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});
