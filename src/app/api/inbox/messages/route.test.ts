import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

describe("POST /api/inbox/messages", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the classification and a Commercial Inquiry for a commercial message", async () => {
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
      extraMocks: () => {
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
      },
    });

    const request = new Request("http://localhost/api/inbox/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
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

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: null,
      extraMocks: () => {
        vi.doMock("@/lib/ai", () => ({
          ai: { classifyMessage: async () => ({}) },
        }));
      },
    });

    const request = new Request("http://localhost/api/inbox/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        creatorId: "00000000-0000-0000-0000-000000000000",
        source: "INSTAGRAM",
        externalContactLabel: "Maria",
        body: "Olá",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 502 with a readable message when the message cannot be classified", async () => {
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
      extraMocks: () => {
        vi.doMock("@/lib/ai", () => ({
          ai: {
            classifyMessage: async () => {
              throw new Error("openai down");
            },
          },
        }));
      },
    });

    const response = await POST(
      new Request("http://localhost/api/inbox/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          creatorId: creator.id,
          source: "INSTAGRAM",
          externalContactLabel: "Maria",
          body: "Olá, gostaríamos de saber os valores para uma campanha.",
        }),
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Não foi possível classificar a mensagem agora. Tente novamente em instantes.",
    });
  });
});
