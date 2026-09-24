import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { services } from "@/db/schema/services";
import { rateCards } from "@/db/schema/rate-cards";
import { RateCardItemService } from "@/services/rate-card-item.service";

describe("GET /api/rate-card-items", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with items enriched with service name", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [service] = await db
      .insert(services)
      .values({ organizationId: org.id, creatorId: creator.id, name: "01 Reel" })
      .returning();
    const [rateCard] = await db
      .insert(rateCards)
      .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela 2026" })
      .returning();

    await RateCardItemService.addItem(db, org.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(org.id, user.id),
    });
    const request = new Request(`http://localhost/api/rate-card-items?creatorId=${creator.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toHaveLength(1);
    expect(json[0].serviceName).toBe("01 Reel");
    expect(json[0].price).toBe(200000);
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const request = new Request(
      "http://localhost/api/rate-card-items?creatorId=00000000-0000-0000-0000-000000000000",
    );
    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});
