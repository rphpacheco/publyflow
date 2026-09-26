import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalService } from "@/services/proposal.service";
import { ProposalSendingService } from "@/services/proposal-sending.service";

function request(token: string, body: unknown) {
  return new Request(`http://localhost/api/public/proposals/${token}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (token: string) => ({ params: Promise.resolve({ token }) });

describe("POST /api/public/proposals/:token/responses (no session)", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function published() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    const sent = await ProposalSendingService.publish(db, seeded.organization.id, seeded.proposal.id, seeded.owner.id);
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: null });
    return { db, ...seeded, sent, token: sent.publicPath.replace("/p/", ""), POST };
  }

  it("201 records the response, with Cache-Control: no-store, without leaking internal ids", async () => {
    const { POST, token, sent } = await published();
    const response = await POST(
      request(token, { publicationId: sent.publication.id, action: "ACCEPT", name: " Maria ", email: "maria@bella.test" }),
      params(token),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.response.action).toBe("ACCEPT");
    expect(body.response.respondedAt).toBeDefined();
    expect(body.response.organizationId).toBeUndefined();
    expect(body.response.publicationId).toBeUndefined();
    expect(body.response.id).toBeUndefined();
  });

  it("ignores a message sent alongside ACCEPT and never stores it", async () => {
    const { db, POST, token, sent, organization, proposal } = await published();
    const response = await POST(
      request(token, {
        publicationId: sent.publication.id,
        action: "ACCEPT",
        name: "Maria",
        email: "maria@bella.test",
        message: "Isso não deveria ser salvo",
      }),
      params(token),
    );
    expect(response.status).toBe(201);

    const state = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(state?.latestPublication?.response?.message).toBeNull();
  });

  it("400 for invalid input, including a missing message when requesting changes", async () => {
    const { POST, token, sent } = await published();
    const base = { publicationId: sent.publication.id, name: "Maria", email: "maria@bella.test" };

    for (const body of [
      { ...base, action: "REQUEST_CHANGES" },
      { ...base, action: "REQUEST_CHANGES", message: "   " },
      { ...base, action: "ACCEPT", email: "nao-e-email" },
      { ...base, action: "ACCEPT", name: "" },
      { ...base, action: "MAYBE" },
      { ...base, action: "ACCEPT", publicationId: "x" },
    ]) {
      const response = await POST(request(token, body), params(token));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("404 unknown token, 410 unavailable, 409 SUPERSEDED and 409 ALREADY_RESPONDED", async () => {
    const { db, POST, token, sent, organization, owner, proposal } = await published();
    const accept = { publicationId: sent.publication.id, action: "ACCEPT", name: "Maria", email: "maria@bella.test" };

    expect((await POST(request("Z".repeat(43), accept), params("Z".repeat(43)))).status).toBe(404);

    const superseded = await POST(request(token, { ...accept, publicationId: "00000000-0000-4000-8000-000000000000" }), params(token));
    expect(superseded.status).toBe(409);
    expect((await superseded.json()).code).toBe("SUPERSEDED");

    expect((await POST(request(token, accept), params(token))).status).toBe(201);
    const twice = await POST(request(token, accept), params(token));
    expect(twice.status).toBe(409);
    expect((await twice.json()).code).toBe("ALREADY_RESPONDED");

    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    expect((await POST(request(token, accept), params(token))).status).toBe(410);
  });
});
