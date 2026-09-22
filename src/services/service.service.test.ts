import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ServiceService } from "./service.service";

describe("ServiceService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates, updates, and deactivates a service", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const created = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "01 Reel",
    });

    const updated = await ServiceService.update(db, organization.id, created.id, {
      description: "Reel patrocinado",
    });
    expect(updated.description).toBe("Reel patrocinado");

    const deactivated = await ServiceService.deactivate(db, organization.id, created.id);
    expect(deactivated.isActive).toBe(false);

    const list = await ServiceService.listByCreator(db, organization.id, creator.id);
    expect(list).toHaveLength(1);
    expect(list[0].isActive).toBe(false);
  });
});
