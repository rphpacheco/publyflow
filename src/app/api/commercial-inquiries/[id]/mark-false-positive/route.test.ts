import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
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

async function setupOrgCreatorAndInquiry(db: Awaited<ReturnType<typeof withTestDb>>["db"]) {
  const { organization } = await OrganizationService.createWithOwner(db, {
    organizationName: "Org",
    ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const creator = await CreatorService.onboardCreator(db, organization.id, {
    email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
    fullName: "Thais",
    displayName: "Thais",
  });
  const { inquiry } = await InboxService.ingestManualMessage(db, fakeAI(), organization.id, {
    creatorId: creator.id,
    source: "INSTAGRAM",
    externalContactLabel: "Maria — Bella Cosméticos",
    body: "Olá, gostaríamos de saber os valores.",
    receivedAt: new Date(),
  });
  return { organization, creator, inquiry: inquiry! };
}

describe("POST /api/commercial-inquiries/:id/mark-false-positive", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 204 and marks the inquiry as FALSE_POSITIVE", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.doMock("@/db", () => ({ db }));

    const { organization, inquiry } = await setupOrgCreatorAndInquiry(db);

    const { POST } = await import("./route");
    const request = new Request(
      `http://localhost/api/commercial-inquiries/${inquiry.id}/mark-false-positive`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      },
    );

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(204);

    const { CommercialInquiriesRepository } = await import(
      "@/repositories/commercial-inquiries.repository"
    );
    const updated = await CommercialInquiriesRepository.findById(db, organization.id, inquiry.id);
    expect(updated?.status).toBe("FALSE_POSITIVE");
  });

  it("returns 404 when the inquiry does not exist for that organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.doMock("@/db", () => ({ db }));

    const { organization } = await setupOrgCreatorAndInquiry(db);

    const { POST } = await import("./route");
    const nonexistentId = "00000000-0000-0000-0000-000000000000";
    const request = new Request(
      `http://localhost/api/commercial-inquiries/${nonexistentId}/mark-false-positive`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      },
    );

    const response = await POST(request, { params: Promise.resolve({ id: nonexistentId }) });
    expect(response.status).toBe(404);
  });

  it("returns 409 when the inquiry is already in a terminal status", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.doMock("@/db", () => ({ db }));

    const { organization, inquiry } = await setupOrgCreatorAndInquiry(db);

    const { CommercialInquiryService } = await import("@/services/commercial-inquiry.service");
    await CommercialInquiryService.discard(db, organization.id, inquiry.id);

    const { POST } = await import("./route");
    const request = new Request(
      `http://localhost/api/commercial-inquiries/${inquiry.id}/mark-false-positive`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      },
    );

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(409);
  });
});
