import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ServiceService } from "@/services/service.service";
import { RateCardService } from "@/services/rate-card.service";

describe("POST /api/rate-cards/:id/items", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the created item on an unlocked rate card", async () => {
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
    const service = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "01 Reel",
    });
    const rateCard = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });

    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const request = new Request(`http://localhost/api/rate-cards/${rateCard.id}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceId: service.id,
        price: 200000,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: rateCard.id }) });
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.price).toBe(200000);
  });

  it("returns 409 when the rate card is locked", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner2@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais2@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });
    const service = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "01 Reel",
    });
    const rateCard = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });
    await RateCardService.lock(db, organization.id, rateCard.id);

    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const request = new Request(`http://localhost/api/rate-cards/${rateCard.id}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceId: service.id,
        price: 200000,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: rateCard.id }) });
    expect(response.status).toBe(409);
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const request = new Request(
      "http://localhost/api/rate-cards/00000000-0000-0000-0000-000000000000/items",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serviceId: "00000000-0000-0000-0000-000000000000",
          price: 200000,
        }),
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(401);
  });
});
