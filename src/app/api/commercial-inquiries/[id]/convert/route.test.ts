import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { InboxService } from "@/services/inbox.service";
import { runInTenantContext } from "@/repositories/tenant-context";
import { companies } from "@/db/schema/companies-brands-contacts";

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

describe("POST /api/commercial-inquiries/:id/convert", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 and converts the inquiry when given an explicit companyId", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner, inquiry } = await setupOrgCreatorAndInquiry(db);
    const [company] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }).returning(),
    );

    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contact: { fullName: "Maria" },
        companyId: company.id,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(200);
  });

  it("returns 404 when the inquiry does not exist for that organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await setupOrgCreatorAndInquiry(db);

    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const nonexistentId = "00000000-0000-0000-0000-000000000000";
    const request = new Request(`http://localhost/api/commercial-inquiries/${nonexistentId}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact: { fullName: "Maria" } }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: nonexistentId }) });
    expect(response.status).toBe(404);
  });

  it("returns 409 when the inquiry is already resolved", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner, inquiry } = await setupOrgCreatorAndInquiry(db);
    const { CommercialInquiryService } = await import("@/services/commercial-inquiry.service");
    await CommercialInquiryService.discard(db, organization.id, inquiry.id);

    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact: { fullName: "Maria" } }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(409);
  });

  it("returns 422 when the company guess matches more than one existing company", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner, inquiry } = await setupOrgCreatorAndInquiry(db);
    await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }),
    );
    await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }),
    );

    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // companyId omitted -- forces guess-based resolution, which is now ambiguous.
      body: JSON.stringify({ contact: { fullName: "Maria" } }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(422);
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: null });
    const nonexistentId = "00000000-0000-0000-0000-000000000000";
    const request = new Request(`http://localhost/api/commercial-inquiries/${nonexistentId}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact: { fullName: "Maria" } }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: nonexistentId }) });
    expect(response.status).toBe(401);
  });
});
