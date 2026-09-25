import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalItemsRepository } from "@/repositories/proposal-items.repository";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalVersionService } from "./proposal-version.service";

describe("ProposalVersionService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: NodePgDatabase<typeof schema>) {
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `thais-${Date.now()}@publyflow.test`, fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const proposal = await ProposalsRepository.create(db, org.id, {
      opportunityId: opportunity.id,
      title: "P",
      theme: "PREMIUM",
    });
    return { org, user, proposal };
  }

  it("builds a snapshot including current items, and creates sequential version numbers", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, user, proposal } = await setup(db);

    await ProposalItemsRepository.create(db, org.id, {
      proposalId: proposal.id,
      rateCardItemId: null,
      description: "Reel",
      unitPrice: 200000,
    });

    const v1 = await runInTenantContext(db, org.id, (tx) =>
      ProposalVersionService.createVersionWithTx(tx, org.id, proposal.id, user.id),
    );
    expect(v1.versionNumber).toBe(1);
    const snapshot1 = v1.snapshotJson as { items: unknown[]; proposal: { title: string } };
    expect(snapshot1.items).toHaveLength(1);
    expect(snapshot1.proposal.title).toBe("P");

    const v2 = await runInTenantContext(db, org.id, (tx) =>
      ProposalVersionService.createVersionWithTx(tx, org.id, proposal.id, user.id),
    );
    expect(v2.versionNumber).toBe(2);

    const list = await ProposalVersionService.listByProposal(db, org.id, proposal.id);
    expect(list).toHaveLength(2);
  });
});
