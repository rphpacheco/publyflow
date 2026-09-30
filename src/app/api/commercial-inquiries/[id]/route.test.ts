import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
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

describe("PATCH /api/commercial-inquiries/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { PATCH } = await importRouteWithSession(() => import("./route"), { db, session: null });
    const nonexistentId = "00000000-0000-0000-0000-000000000000";
    const request = new Request(`http://localhost/api/commercial-inquiries/${nonexistentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: "x" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: nonexistentId }) });
    expect(response.status).toBe(401);
  });

  it("returns 403 for a CREATOR session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner, creator, inquiry } = await setupOrgCreatorAndInquiry(db);

    const { PATCH } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, owner.id, creator.id),
    });
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: "x" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(403);
  });

  it("returns 404 with the Portuguese message for a malformed id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await setupOrgCreatorAndInquiry(db);

    const { PATCH } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const request = new Request("http://localhost/api/commercial-inquiries/not-a-uuid", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: "x" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Mensagem não encontrada." });
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

    const { PATCH } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(otherOrganization.id, otherOwner.id),
    });
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: "x" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Mensagem não encontrada." });
  });

  it("returns 409 with the Portuguese message for a discarded inquiry", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner, inquiry } = await setupOrgCreatorAndInquiry(db);
    const { CommercialInquiryService } = await import("@/services/commercial-inquiry.service");
    await CommercialInquiryService.discard(db, organization.id, inquiry.id);

    const { PATCH } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: "x" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Esta mensagem já foi resolvida." });
  });

  it("returns 400 with errors for an empty body", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner, inquiry } = await setupOrgCreatorAndInquiry(db);

    const { PATCH } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toBeDefined();
  });

  it("returns 400 when companyName exceeds 200 characters", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner, inquiry } = await setupOrgCreatorAndInquiry(db);

    const { PATCH } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: "x".repeat(201) }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toBeDefined();
  });

  it("returns 200 and the updated companyGuess", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner, inquiry } = await setupOrgCreatorAndInquiry(db);

    const { PATCH } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: "Barbosa Moda" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.companyGuess).toBe("Barbosa Moda");
  });

  it("returns 400 (not 500) for a non-JSON body", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner, inquiry } = await setupOrgCreatorAndInquiry(db);

    const { PATCH } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const request = new Request(`http://localhost/api/commercial-inquiries/${inquiry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "not json",
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toBeDefined();
  });
});
