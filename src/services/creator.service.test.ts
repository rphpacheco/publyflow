import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { users } from "@/db/schema/organizations";

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

  it("leaves no orphaned users row when the creator insert fails (Fix 5)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}@publyflow.test`,
      ownerFullName: "Owner",
    });

    const email = `orphan-check-${Date.now()}@publyflow.test`;

    // Simulate a failure partway through onboardCreator: the `users`
    // insert succeeds, then the creator insert throws. This proves both
    // inserts share one transaction -- if they didn't, the `users` row
    // would remain committed despite onboardCreator rejecting, and since
    // users.email is UNIQUE, retrying with the same email would then fail
    // with a duplicate-email error instead of the original one.
    const createSpy = vi
      .spyOn(CreatorsRepository, "createWithTx")
      .mockRejectedValue(new Error("simulated creator insert failure"));

    try {
      await expect(
        CreatorService.onboardCreator(db, organization.id, {
          email,
          fullName: "Orphan Check",
          displayName: "Orphan Check",
        }),
      ).rejects.toThrow("simulated creator insert failure");
    } finally {
      createSpy.mockRestore();
    }

    const remainingUsers = await db.select().from(users).where(eq(users.email, email));
    expect(remainingUsers).toHaveLength(0);

    // Retrying with the same email must now succeed (no duplicate-email
    // error from an orphaned row).
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email,
      fullName: "Orphan Check",
      displayName: "Orphan Check",
    });
    expect(creator.displayName).toBe("Orphan Check");
  });
});
