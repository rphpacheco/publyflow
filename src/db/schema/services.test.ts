import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { services } from "./services";

describe("services schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("stores a service scoped to organization and creator, defaulting isActive true", async () => {
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
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        name: "01 Reel",
        description: "Reel patrocinado no feed",
        unitDescription: "por publicação",
      })
      .returning();

    expect(service.organizationId).toBe(org.id);
    expect(service.creatorId).toBe(creator.id);
    expect(service.isActive).toBe(true);
  });
});
