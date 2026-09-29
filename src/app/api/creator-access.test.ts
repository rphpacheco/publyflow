import { describe, it, expect, afterAll, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, creatorSession } from "@/test/helpers/route";
import { seedTwoCreators } from "@/test/helpers/two-creators";

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

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
    const cases: Array<[() => Promise<Record<string, unknown>>, string, string, Record<string, string>]> = [
      [() => import("./proposals/route"), "POST", "/api/proposals", {}],
      [() => import("./proposals/[id]/route"), "PATCH", `/api/proposals/${p}`, { id: p }],
      [() => import("./proposals/[id]/blocks/route"), "POST", `/api/proposals/${p}/blocks`, { id: p }],
      [() => import("./proposals/[id]/items/route"), "POST", `/api/proposals/${p}/items`, { id: p }],
      [() => import("./proposals/[id]/publications/route"), "POST", `/api/proposals/${p}/publications`, { id: p }],
      [() => import("./opportunities/[id]/route"), "PATCH", `/api/opportunities/${x.opportunity.id}`, { id: x.opportunity.id }],
      [() => import("./rate-cards/route"), "POST", "/api/rate-cards", {}],
      [() => import("./services/route"), "POST", "/api/services", {}],
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

  it("org CRM lists are 403", async () => {
    const { call } = await setup();
    for (const [load, url] of [
      [() => import("./companies/route"), "/api/companies"],
      [() => import("./contacts/route"), "/api/contacts"],
      [() => import("./brands/route"), "/api/brands"],
      [() => import("./leads/route"), "/api/leads"],
    ] as const) {
      expect((await call(load, "GET", url)).status, url).toBe(403);
    }
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
    expect(await response.json()).toEqual([{ id: x.creator.id, displayName: x.creator.displayName, instagramHandle: x.creator.instagramHandle }]);
  });
});
