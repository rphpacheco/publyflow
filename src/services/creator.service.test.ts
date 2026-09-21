import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";

describe("CreatorService.onboardCreator", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a user and a linked creator in the same organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });

    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais Miranda",
      displayName: "Thais Miranda",
      instagramHandle: "thaimiranda",
    });

    expect(creator.organizationId).toBe(organization.id);
    expect(creator.displayName).toBe("Thais Miranda");
  });
});
