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

async function setupOrgCreatorAndInquiry(db: Awaited<ReturnType<typeof withTestDb>>["db"]) {
  const { organization, owner } = await OrganizationService.createWithOwner(db, {
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
  return { organization, owner, creator, inquiry: inquiry! };
}

describe("POST /api/commercial-inquiries/:id/discard", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const nonexistentId = "00000000-0000-0000-0000-000000000000";
    const request = new Request(
      `http://localhost/api/commercial-inquiries/${nonexistentId}/discard`,
      { method: "POST" },
    );

    const response = await POST(request, { params: Promise.resolve({ id: nonexistentId }) });
    expect(response.status).toBe(401);
  });

  it("returns 404 with the Portuguese message for another organization's inquiry", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { inquiry } = await setupOrgCreatorAndInquiry(db);
    const { organization: otherOrganization, owner: otherOwner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Other Org",
      ownerEmail: `other-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Other Owner",
    });

    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(otherOrganization.id, otherOwner.id),
    });
    const request = new Request(
      `http://localhost/api/commercial-inquiries/${inquiry.id}/discard`,
      { method: "POST" },
    );

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Mensagem não encontrada." });
  });

  it("returns 409 with the Portuguese message when the inquiry is already resolved", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner, inquiry } = await setupOrgCreatorAndInquiry(db);
    const { CommercialInquiryService } = await import("@/services/commercial-inquiry.service");
    await CommercialInquiryService.discard(db, organization.id, inquiry.id);

    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const request = new Request(
      `http://localhost/api/commercial-inquiries/${inquiry.id}/discard`,
      { method: "POST" },
    );

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Esta mensagem já foi resolvida." });
  });
});
