import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { InboxService } from "@/services/inbox.service";

describe("GET /api/commercial-inquiries", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the creator's inquiries", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));
    vi.doMock("@/lib/ai", () => ({
      ai: {
        classifyMessage: async () => ({
          category: "COMMERCIAL_LEAD",
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

    const { ai } = await import("@/lib/ai");
    await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores.",
      receivedAt: new Date(),
    });

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/commercial-inquiries?organizationId=${organization.id}&creatorId=${creator.id}`,
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
});
