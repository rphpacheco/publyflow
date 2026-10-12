import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";

// Invalid input must answer 400 { errors } (never a 500 from a thrown ZodError / JSON SyntaxError).
// Validation runs before any DB access, so a session with random ids is enough.
const ID = "00000000-0000-0000-0000-000000000001";
const withId = { params: Promise.resolve({ id: ID }) };

type Routes = Record<string, unknown>;
type Handler = (request: Request, ctx?: unknown) => Promise<Response>;

describe("invalid input returns 400 instead of 500", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function load(importRoute: () => Promise<Routes>) {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    return importRouteWithSession(importRoute, { db, session: ownerSession(randomUUID(), randomUUID()) });
  }

  const lists: Array<[string, () => Promise<Routes>, string?]> = [
    ["/api/commercial-inquiries", () => import("./commercial-inquiries/route")],
    ["/api/opportunities", () => import("./opportunities/route")],
    ["/api/leads", () => import("./leads/route")],
    ["/api/rate-card-items", () => import("./rate-card-items/route")],
    ["/api/rate-cards", () => import("./rate-cards/route")],
    ["/api/services", () => import("./services/route")],
    ["/api/proposals", () => import("./proposals/route"), "opportunityId"],
  ];

  for (const [path, importRoute, field = "creatorId"] of lists) {
    it(`GET ${path} without ${field} -> 400 with errors.${field}`, async () => {
      const route = await load(importRoute);
      const response = await (route.GET as Handler)(new Request(`http://localhost${path}`));
      expect(response.status).toBe(400);
      expect((await response.json()).errors[field]).toBeDefined();
    });

    it(`GET ${path} with an invalid ${field} -> 400`, async () => {
      const route = await load(importRoute);
      const response = await (route.GET as Handler)(new Request(`http://localhost${path}?${field}=nope`));
      expect(response.status).toBe(400);
      expect((await response.json()).errors[field]).toBeDefined();
    });
  }

  const bodies: Array<[string, string, () => Promise<Routes>, boolean]> = [
    ["POST", "/api/inbox/messages", () => import("./inbox/messages/route"), false],
    ["POST", "/api/proposals", () => import("./proposals/route"), false],
    ["POST", "/api/services", () => import("./services/route"), false],
    ["POST", "/api/rate-cards", () => import("./rate-cards/route"), false],
    ["PATCH", "/api/opportunities/:id", () => import("./opportunities/[id]/route"), true],
    ["PATCH", "/api/proposal-items/:id", () => import("./proposal-items/[id]/route"), true],
    ["DELETE", "/api/proposal-items/:id", () => import("./proposal-items/[id]/route"), true],
    ["PATCH", "/api/proposal-blocks/:id", () => import("./proposal-blocks/[id]/route"), true],
    ["DELETE", "/api/proposal-blocks/:id", () => import("./proposal-blocks/[id]/route"), true],
    ["PATCH", "/api/rate-card-items/:id", () => import("./rate-card-items/[id]/route"), true],
    ["DELETE", "/api/rate-card-items/:id", () => import("./rate-card-items/[id]/route"), true],
    ["POST", "/api/rate-cards/:id/items", () => import("./rate-cards/[id]/items/route"), true],
    ["POST", "/api/rate-cards/:id/duplicate", () => import("./rate-cards/[id]/duplicate/route"), true],
    ["PATCH", "/api/services/:id", () => import("./services/[id]/route"), true],
    ["PATCH", "/api/proposals/:id", () => import("./proposals/[id]/route"), true],
    ["POST", "/api/proposals/:id/blocks", () => import("./proposals/[id]/blocks/route"), true],
    ["POST", "/api/proposals/:id/items", () => import("./proposals/[id]/items/route"), true],
  ];

  for (const [method, path, importRoute, hasId] of bodies) {
    const call = async (route: Routes, body: string) => {
      const request = new Request(`http://localhost${path.replace(":id", ID)}`, {
        method,
        headers: { "content-type": "application/json" },
        body,
      });
      const handler = route[method] as Handler;
      return hasId ? handler(request, withId) : handler(request);
    };

    it(`${method} ${path} with invalid JSON -> 400`, async () => {
      const route = await load(importRoute);
      const response = await call(route, "{");
      expect(response.status).toBe(400);
      expect((await response.json()).errors).toEqual({ form: ["Corpo da requisição inválido."] });
    });

    it(`${method} ${path} with a schema violation -> 400 with errors`, async () => {
      const route = await load(importRoute);
      const response = await call(route, JSON.stringify({ proposalId: 123, creatorId: "nope", stage: 5, name: 5, title: 5, theme: "nope", status: "nope" }));
      expect(response.status).toBe(400);
      const { errors } = await response.json();
      expect(Object.keys(errors).length).toBeGreaterThan(0);
    });
  }
});
