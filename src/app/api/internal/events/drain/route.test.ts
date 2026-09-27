import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalSendingService } from "@/services/proposal-sending.service";

const request = (method: "GET" | "POST", token?: string) =>
  new Request("http://localhost/api/internal/events/drain", {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe("/api/internal/events/drain", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanup?.();
  });

  it("503 when CRON_SECRET is not configured (fail-closed)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.stubEnv("CRON_SECRET", "");
    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });
    expect((await GET(request("GET", "anything"))).status).toBe(503);
  });

  it("401 without or with a wrong bearer token", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.stubEnv("CRON_SECRET", "s3cret");
    const { GET, POST } = await importRouteWithSession(() => import("./route"), { db, session: null });
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", "wrong"))).status).toBe(401);
  });

  it("200 drains pending events with the right token (GET for cron, POST for kicks)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.stubEnv("CRON_SECRET", "s3cret");
    const { organization, owner, proposal } = await seedProposal(db);
    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const { GET, POST } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const response = await GET(request("GET", "s3cret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1, failed: 0 });
    expect(await (await POST(request("POST", "s3cret"))).json()).toEqual({ processed: 0, failed: 0 });
  });
});
