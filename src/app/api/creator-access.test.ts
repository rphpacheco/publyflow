import { describe, it, expect, afterAll, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, creatorSession } from "@/test/helpers/route";
import { seedTwoCreators } from "@/test/helpers/two-creators";
import { InboxService } from "@/services/inbox.service";

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

// Placeholder path-param id for routes whose CREATOR check (deny or CRM 403)
// fires before any DB lookup or body parse, so no real row is needed.
const PLACEHOLDER_ID = "11111111-1111-1111-1111-111111111111";

describe("CREATOR access rules", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterAll(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedTwoCreators(db);
    const session = creatorSession(seeded.organization.id, seeded.x.user.id, seeded.x.creator.id);
    const call = async (load: () => Promise<Record<string, unknown>>, method: string, url: string, params: Record<string, string> = {}, body?: unknown) => {
      const handlers = await importRouteWithSession(load, {
        db,
        session,
        extraMocks: () => {
          vi.doMock("@/lib/ai", () => ({
            ai: {
              classifyMessage: async () => ({
                category: "COMMERCIAL_LEAD",
                commercialScore: 90,
                intent: null,
                extracted: { companyName: null, brandName: null, contactName: null, email: null, phone: null, budget: null, deliverables: null },
              }),
            },
          }));
        },
      });
      const init: RequestInit = { method };
      if (body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      return (handlers[method] as Handler)(new Request(`http://localhost${url}`, init), { params: Promise.resolve(params) });
    };
    return { db, ...seeded, call };
  }

  it("denies writes with 403", async () => {
    const { x, call } = await setup();
    const p = x.proposal.id;
    const id = PLACEHOLDER_ID;
    const cases: Array<[() => Promise<Record<string, unknown>>, string, string, Record<string, string>]> = [
      [() => import("./proposals/route"), "POST", "/api/proposals", {}],
      [() => import("./proposals/[id]/route"), "PATCH", `/api/proposals/${p}`, { id: p }],
      [() => import("./proposals/[id]/blocks/route"), "POST", `/api/proposals/${p}/blocks`, { id: p }],
      [() => import("./proposals/[id]/items/route"), "POST", `/api/proposals/${p}/items`, { id: p }],
      [() => import("./proposals/[id]/publications/route"), "POST", `/api/proposals/${p}/publications`, { id: p }],
      [() => import("./opportunities/[id]/route"), "PATCH", `/api/opportunities/${x.opportunity.id}`, { id: x.opportunity.id }],
      [() => import("./rate-cards/route"), "POST", "/api/rate-cards", {}],
      [() => import("./services/route"), "POST", "/api/services", {}],
      [() => import("./proposal-blocks/[id]/route"), "PATCH", `/api/proposal-blocks/${id}`, { id }],
      [() => import("./proposal-blocks/[id]/route"), "DELETE", `/api/proposal-blocks/${id}`, { id }],
      [() => import("./proposal-items/[id]/route"), "PATCH", `/api/proposal-items/${id}`, { id }],
      [() => import("./proposal-items/[id]/route"), "DELETE", `/api/proposal-items/${id}`, { id }],
      [() => import("./commercial-inquiries/[id]/convert/route"), "POST", `/api/commercial-inquiries/${id}/convert`, { id }],
      [() => import("./commercial-inquiries/[id]/discard/route"), "POST", `/api/commercial-inquiries/${id}/discard`, { id }],
      [() => import("./commercial-inquiries/[id]/mark-false-positive/route"), "POST", `/api/commercial-inquiries/${id}/mark-false-positive`, { id }],
      [() => import("./rate-cards/[id]/duplicate/route"), "POST", `/api/rate-cards/${id}/duplicate`, { id }],
      [() => import("./rate-cards/[id]/items/route"), "POST", `/api/rate-cards/${id}/items`, { id }],
      [() => import("./rate-card-items/[id]/route"), "PATCH", `/api/rate-card-items/${id}`, { id }],
      [() => import("./rate-card-items/[id]/route"), "DELETE", `/api/rate-card-items/${id}`, { id }],
      [() => import("./services/[id]/route"), "PATCH", `/api/services/${id}`, { id }],
      [() => import("./creators/route"), "POST", "/api/creators", {}],
      [() => import("./creators/[id]/route"), "PATCH", `/api/creators/${id}`, { id }],
    ];
    for (const [load, method, url, params] of cases) {
      const response = await call(load, method, url, params, {});
      expect(response.status, `${method} ${url}`).toBe(403);
      expect(await response.json()).toEqual({ error: "Sem permissão." });
    }
  });

  it("404 for another creator's proposal and opportunity, 200 for its own", async () => {
    const { x, y, call } = await setup();
    for (const [load, suffix] of [
      [() => import("./proposals/[id]/route"), ""],
      [() => import("./proposals/[id]/blocks/route"), "/blocks"],
      [() => import("./proposals/[id]/items/route"), "/items"],
      [() => import("./proposals/[id]/versions/route"), "/versions"],
      [() => import("./proposals/[id]/publications/route"), "/publications"],
      [() => import("./proposals/[id]/send-state/route"), "/send-state"],
      [() => import("./proposals/[id]/share-info/route"), "/share-info"],
    ] as const) {
      expect((await call(load, "GET", `/api/proposals/${y.proposal.id}${suffix}`, { id: y.proposal.id })).status, `Y ${suffix}`).toBe(404);
      expect((await call(load, "GET", `/api/proposals/${x.proposal.id}${suffix}`, { id: x.proposal.id })).status, `X ${suffix}`).toBe(200);
    }
    const opp = () => import("./opportunities/[id]/route");
    expect((await call(opp, "GET", `/api/opportunities/${y.opportunity.id}`, { id: y.opportunity.id })).status).toBe(404);
    expect((await call(opp, "GET", `/api/opportunities/${x.opportunity.id}`, { id: x.opportunity.id })).status).toBe(200);
  });

  it("lists are forced to the session's creator", async () => {
    const { x, y, call } = await setup();
    const list = await call(() => import("./opportunities/route"), "GET", `/api/opportunities?creatorId=${y.creator.id}`);
    expect(list.status).toBe(200);
    const items = (await list.json()) as Array<{ id: string }>;
    expect(items.map((item) => item.id)).toEqual([x.opportunity.id]);
  });

  it("proposals list for another creator's opportunity is an empty 200, own opportunity returns its proposal", async () => {
    const { x, y, call } = await setup();
    const yList = await call(() => import("./proposals/route"), "GET", `/api/proposals?opportunityId=${y.opportunity.id}`);
    expect(yList.status).toBe(200);
    expect(await yList.json()).toEqual([]);

    const xList = await call(() => import("./proposals/route"), "GET", `/api/proposals?opportunityId=${x.opportunity.id}`);
    expect(xList.status).toBe(200);
    const items = (await xList.json()) as Array<{ id: string }>;
    expect(items.map((item) => item.id)).toEqual([x.proposal.id]);
  });

  it("commercial-inquiries list is forced to the session's creator", async () => {
    const { db, organization, x, y, call } = await setup();
    const fakeAi = {
      classifyMessage: async () => ({
        category: "COMMERCIAL_LEAD" as const,
        commercialScore: 90,
        intent: null,
        extracted: { companyName: null, brandName: null, contactName: null, email: null, phone: null, budget: null, deliverables: null },
      }),
    };
    await InboxService.ingestManualMessage(db, fakeAi, organization.id, {
      creatorId: x.creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Cliente X",
      body: "Quero uma proposta.",
      receivedAt: new Date(),
    });
    await InboxService.ingestManualMessage(db, fakeAi, organization.id, {
      creatorId: y.creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Cliente Y",
      body: "Quero uma proposta.",
      receivedAt: new Date(),
    });

    const response = await call(() => import("./commercial-inquiries/route"), "GET", `/api/commercial-inquiries?creatorId=${y.creator.id}`);
    expect(response.status).toBe(200);
    const items = (await response.json()) as Array<{ creatorId: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.creatorId === x.creator.id)).toBe(true);
  });

  it("org CRM lists and detail routes are 403", async () => {
    const { call } = await setup();
    const id = PLACEHOLDER_ID;
    for (const [load, url, params] of [
      [() => import("./companies/route"), "/api/companies", {}],
      [() => import("./contacts/route"), "/api/contacts", {}],
      [() => import("./brands/route"), "/api/brands", {}],
      [() => import("./leads/route"), "/api/leads", {}],
      [() => import("./companies/[id]/route"), `/api/companies/${id}`, { id }],
      [() => import("./contacts/[id]/route"), `/api/contacts/${id}`, { id }],
      [() => import("./leads/[id]/route"), `/api/leads/${id}`, { id }],
      [() => import("./rate-cards/route"), "/api/rate-cards", {}],
      [() => import("./rate-card-items/route"), "/api/rate-card-items", {}],
      [() => import("./services/route"), "/api/services", {}],
    ] as const) {
      expect((await call(load, "GET", url, params)).status, url).toBe(403);
    }
  });

  it("notifications endpoints are not blocked for CREATOR", async () => {
    const { call } = await setup();
    const listResponse = await call(() => import("./notifications/route"), "GET", "/api/notifications");
    expect(listResponse.status).not.toBe(403);

    const patchResponse = await call(
      () => import("./notifications/[id]/route"),
      "PATCH",
      `/api/notifications/${PLACEHOLDER_ID}`,
      { id: PLACEHOLDER_ID },
    );
    expect(patchResponse.status).not.toBe(403);

    const readAllResponse = await call(() => import("./notifications/read-all/route"), "POST", "/api/notifications/read-all");
    expect(readAllResponse.status).not.toBe(403);
  });

  it("inbox message is created for the session's creator even if the body says otherwise", async () => {
    const { x, y, call } = await setup();
    const response = await call(() => import("./inbox/messages/route"), "POST", "/api/inbox/messages", {}, {
      creatorId: y.creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Joana",
      body: "Queremos uma proposta.",
    });
    expect(response.status).toBe(201);
    expect((await response.json()).inquiry.creatorId).toBe(x.creator.id);
  });

  it("GET /api/creators returns only its own creator without e-mail", async () => {
    const { x, call } = await setup();
    const response = await call(() => import("./creators/route"), "GET", "/api/creators");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: x.creator.id, displayName: x.creator.displayName, instagramHandle: x.creator.instagramHandle }]);
  });
});
