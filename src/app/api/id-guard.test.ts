import { describe, it, expect, afterAll } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OpportunityNotFoundError } from "@/domain/commercial-flow/errors";
import { BRAND_NOT_FOUND, COMPANY_NOT_FOUND, CONTACT_NOT_FOUND } from "./crm-errors";
import { INQUIRY_NOT_FOUND } from "./commercial-inquiries/[id]/inquiry-errors";
import { ProposalNotFoundError } from "@/domain/proposals/errors";
import { RateCardNotFoundError, ServiceNotFoundError } from "@/domain/rate-cards/errors";
import { CreatorNotFoundError } from "@/domain/creators/errors";

const BAD = "not-a-uuid";
const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";

type Handler = (request: Request, context: { params: Promise<{ id: string; aliasId?: string }> }) => Promise<Response>;

const cases: Array<{ route: string; load: () => Promise<Record<string, unknown>>; methods: string[]; error: string }> = [
  { route: "companies/[id]", load: () => import("./companies/[id]/route"), methods: ["GET", "PATCH"], error: COMPANY_NOT_FOUND },
  { route: "companies/[id]/merge-preview", load: () => import("./companies/[id]/merge-preview/route"), methods: ["GET"], error: COMPANY_NOT_FOUND },
  { route: "companies/[id]/merge", load: () => import("./companies/[id]/merge/route"), methods: ["POST"], error: COMPANY_NOT_FOUND },
  { route: "contacts/[id]/merge-preview", load: () => import("./contacts/[id]/merge-preview/route"), methods: ["GET"], error: CONTACT_NOT_FOUND },
  { route: "contacts/[id]/merge", load: () => import("./contacts/[id]/merge/route"), methods: ["POST"], error: CONTACT_NOT_FOUND },
  { route: "companies/[id]/aliases/[aliasId]", load: () => import("./companies/[id]/aliases/[aliasId]/route"), methods: ["DELETE"], error: COMPANY_NOT_FOUND },
  { route: "contacts/[id]", load: () => import("./contacts/[id]/route"), methods: ["GET", "PATCH"], error: CONTACT_NOT_FOUND },
  { route: "brands/[id]", load: () => import("./brands/[id]/route"), methods: ["PATCH"], error: BRAND_NOT_FOUND },
  { route: "leads/[id]", load: () => import("./leads/[id]/route"), methods: ["GET"], error: `Lead ${BAD} not found` },
  { route: "opportunities/[id]", load: () => import("./opportunities/[id]/route"), methods: ["GET", "PATCH"], error: new OpportunityNotFoundError(BAD).message },
  { route: "commercial-inquiries/[id]", load: () => import("./commercial-inquiries/[id]/route"), methods: ["PATCH"], error: INQUIRY_NOT_FOUND },
  { route: "commercial-inquiries/[id]/convert", load: () => import("./commercial-inquiries/[id]/convert/route"), methods: ["POST"], error: INQUIRY_NOT_FOUND },
  { route: "commercial-inquiries/[id]/discard", load: () => import("./commercial-inquiries/[id]/discard/route"), methods: ["POST"], error: INQUIRY_NOT_FOUND },
  { route: "commercial-inquiries/[id]/mark-false-positive", load: () => import("./commercial-inquiries/[id]/mark-false-positive/route"), methods: ["POST"], error: INQUIRY_NOT_FOUND },
  { route: "proposals/[id]", load: () => import("./proposals/[id]/route"), methods: ["GET", "PATCH"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/blocks", load: () => import("./proposals/[id]/blocks/route"), methods: ["GET", "POST"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/items", load: () => import("./proposals/[id]/items/route"), methods: ["GET", "POST"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/versions", load: () => import("./proposals/[id]/versions/route"), methods: ["GET"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/publications", load: () => import("./proposals/[id]/publications/route"), methods: ["POST", "GET"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/approval", load: () => import("./proposals/[id]/approval/route"), methods: ["POST"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/approval/approve", load: () => import("./proposals/[id]/approval/approve/route"), methods: ["POST"], error: new ProposalNotFoundError(BAD).message },
  {
    route: "proposals/[id]/approval/request-changes",
    load: () => import("./proposals/[id]/approval/request-changes/route"),
    methods: ["POST"],
    error: new ProposalNotFoundError(BAD).message,
  },
  { route: "proposals/[id]/send-state", load: () => import("./proposals/[id]/send-state/route"), methods: ["GET"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/share-info", load: () => import("./proposals/[id]/share-info/route"), methods: ["GET"], error: new ProposalNotFoundError(BAD).message },
  { route: "notifications/[id]", load: () => import("./notifications/[id]/route"), methods: ["PATCH"], error: "Notificação não encontrada." },
  { route: "proposal-blocks/[id]", load: () => import("./proposal-blocks/[id]/route"), methods: ["PATCH", "DELETE"], error: "Não encontrado." },
  { route: "proposal-items/[id]", load: () => import("./proposal-items/[id]/route"), methods: ["PATCH", "DELETE"], error: "Não encontrado." },
  { route: "rate-card-items/[id]", load: () => import("./rate-card-items/[id]/route"), methods: ["PATCH", "DELETE"], error: "Não encontrado." },
  { route: "rate-cards/[id]/duplicate", load: () => import("./rate-cards/[id]/duplicate/route"), methods: ["POST"], error: new RateCardNotFoundError(BAD).message },
  { route: "rate-cards/[id]/items", load: () => import("./rate-cards/[id]/items/route"), methods: ["POST"], error: new RateCardNotFoundError(BAD).message },
  { route: "services/[id]", load: () => import("./services/[id]/route"), methods: ["PATCH"], error: new ServiceNotFoundError(BAD).message },
  { route: "creators/[id]", load: () => import("./creators/[id]/route"), methods: ["PATCH"], error: new CreatorNotFoundError(BAD).message },
  { route: "creators/[id]/access", load: () => import("./creators/[id]/access/route"), methods: ["POST", "DELETE"], error: new CreatorNotFoundError(BAD).message },
  { route: "creators/[id]/access/remind", load: () => import("./creators/[id]/access/remind/route"), methods: ["POST"], error: new CreatorNotFoundError(BAD).message },
];

describe("malformed [id] returns the route's 404, never a 500", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterAll(async () => cleanup?.());

  for (const { route, load, methods, error } of cases) {
    for (const method of methods) {
      it(`${method} /api/${route}`, async () => {
        const { db, cleanup: c } = await withTestDb();
        cleanup = c;
        const handlers = await importRouteWithSession(load, { db, session: ownerSession(ORG, USER) });
        const handler = handlers[method] as Handler;
        const init: RequestInit = { method };
        if (method !== "GET" && method !== "DELETE") {
          init.headers = { "content-type": "application/json" };
          init.body = "not json";
        }
        const response = await handler(new Request(`http://localhost/api/${route.replace("[id]", BAD).replace("[aliasId]", BAD)}`, init), {
          params: Promise.resolve({ id: BAD, aliasId: BAD }),
        });

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error });
      });
    }
  }

  it("still answers 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { GET } = (await importRouteWithSession(() => import("./proposals/[id]/route"), { db, session: null })) as {
      GET: Handler;
    };
    const response = await GET(new Request(`http://localhost/api/proposals/${BAD}`), { params: Promise.resolve({ id: BAD }) });
    expect(response.status).toBe(401);
  });
});
