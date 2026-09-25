import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { ProposalsRepository } from "./proposals.repository";
import { runInTenantContext } from "./tenant-context";
import { ProposalVersionsRepository } from "./proposal-versions.repository";

describe("ProposalVersionsRepository", () => {
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

  it("inserts a version row and counts existing versions for a proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, user, proposal } = await setup(db);

    const countBefore = await runInTenantContext(db, org.id, (tx) =>
      ProposalVersionsRepository.countByProposalWithTx(tx, org.id, proposal.id),
    );
    expect(countBefore).toBe(0);

    const version = await runInTenantContext(db, org.id, (tx) =>
      ProposalVersionsRepository.insertWithTx(tx, org.id, proposal.id, 1, { proposal: { title: "P" } }, user.id),
    );
    expect(version.versionNumber).toBe(1);

    const countAfter = await runInTenantContext(db, org.id, (tx) =>
      ProposalVersionsRepository.countByProposalWithTx(tx, org.id, proposal.id),
    );
    expect(countAfter).toBe(1);

    const list = await ProposalVersionsRepository.listByProposal(db, org.id, proposal.id);
    expect(list).toHaveLength(1);
  });
});
