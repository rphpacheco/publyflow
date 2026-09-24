import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession } from "@/test/helpers/route";

describe("POST /api/commercial-inquiries/:id/discard", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const nonexistentId = "00000000-0000-0000-0000-000000000000";
    const request = new Request(
      `http://localhost/api/commercial-inquiries/${nonexistentId}/discard`,
      { method: "POST" },
    );

    const response = await POST(request, { params: Promise.resolve({ id: nonexistentId }) });
    expect(response.status).toBe(401);
  });
});
