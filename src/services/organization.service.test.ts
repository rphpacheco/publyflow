import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { organizationMembers } from "@/db/schema/organizations";
import { runInTenantContext } from "@/repositories/tenant-context";

describe("OrganizationService.createWithOwner", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates an organization, an owner user, and an OWNER membership", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Thais Miranda Management",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Raphael Pacheco",
    });

    const members = await runInTenantContext(db, organization.id, (tx) =>
      tx.select().from(organizationMembers),
    );

    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(owner.id);
    expect(members[0].role).toBe("OWNER");
  });
});
