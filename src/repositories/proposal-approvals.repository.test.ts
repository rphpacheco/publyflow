import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalApprovalsRepository } from "./proposal-approvals.repository";
import { ProposalVersionsRepository } from "./proposal-versions.repository";
import { runInTenantContext } from "./tenant-context";
import { organizationMembers } from "@/db/schema/organizations";
import { proposalApprovals } from "@/db/schema/proposals";

describe("ProposalApprovalsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    const [version] = await ProposalVersionsRepository.listByProposal(db, seeded.organization.id, seeded.proposal.id);
    return { db, ...seeded, version };
  }

  it("numbers requests 1, 2 per proposal and finds the latest", async () => {
    const { db, organization, owner, proposal, version } = await setup();
    const input = { proposalId: proposal.id, versionId: version.id, versionNumber: version.versionNumber, requestedBy: owner.id };
    await runInTenantContext(db, organization.id, (tx) => ProposalApprovalsRepository.insertWithTx(tx, organization.id, input));
    const second = await runInTenantContext(db, organization.id, (tx) => ProposalApprovalsRepository.insertWithTx(tx, organization.id, input));
    expect(second.requestNumber).toBe(2);
    const latest = await runInTenantContext(db, organization.id, (tx) => ProposalApprovalsRepository.findLatestWithTx(tx, organization.id, proposal.id));
    expect(latest?.id).toBe(second.id);
    const withName = await runInTenantContext(db, organization.id, (tx) =>
      ProposalApprovalsRepository.findLatestWithRequesterWithTx(tx, organization.id, proposal.id),
    );
    expect(withName).toMatchObject({ approval: { id: second.id }, requestedByName: "Owner" });
  });

  it("decides once; a second decision returns null", async () => {
    const { db, organization, owner, creator, proposal, version } = await setup();
    const approval = await runInTenantContext(db, organization.id, (tx) =>
      ProposalApprovalsRepository.insertWithTx(tx, organization.id, { proposalId: proposal.id, versionId: version.id, versionNumber: 1, requestedBy: owner.id }),
    );
    const decide = () =>
      runInTenantContext(db, organization.id, (tx) =>
        ProposalApprovalsRepository.decideWithTx(tx, organization.id, approval.id, {
          decision: "APPROVED",
          decidedBy: creator.userId,
          decidedAt: new Date(),
          message: null,
        }),
      );
    expect((await decide())?.decision).toBe("APPROVED");
    expect(await decide()).toBeNull();
  });

  it("rejects CHANGES_REQUESTED without a message and inconsistent decision columns", async () => {
    const { db, organization, owner, creator, proposal, version } = await setup();
    const base = { organizationId: organization.id, proposalId: proposal.id, versionId: version.id, versionNumber: 1, requestedBy: owner.id };
    await expect(
      db.insert(proposalApprovals).values({ ...base, requestNumber: 1, decision: "CHANGES_REQUESTED", decidedBy: creator.userId, decidedAt: new Date(), message: "  " }),
    ).rejects.toThrow();
    await expect(db.insert(proposalApprovals).values({ ...base, requestNumber: 2, decision: "APPROVED" })).rejects.toThrow();
  });

  it("creatorAccessForProposal: hasAccess only with a CREATOR membership in this org", async () => {
    const { db, organization, creator, proposal } = await setup();
    const read = () =>
      runInTenantContext(db, organization.id, (tx) => ProposalApprovalsRepository.creatorAccessForProposalWithTx(tx, organization.id, proposal.id));
    expect(await read()).toEqual({ creatorId: creator.id, creatorUserId: creator.userId, creatorDisplayName: "Thais", hasAccess: false });
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creator.userId, role: "CREATOR" });
    expect((await read())?.hasAccess).toBe(true);
  });

  it("scopes by organization: another org sees nothing", async () => {
    const { db, organization, owner, proposal, version } = await setup();
    const other = await seedProposal(db);
    await runInTenantContext(db, organization.id, (tx) =>
      ProposalApprovalsRepository.insertWithTx(tx, organization.id, { proposalId: proposal.id, versionId: version.id, versionNumber: 1, requestedBy: owner.id }),
    );
    const leaked = await runInTenantContext(db, other.organization.id, (tx) =>
      ProposalApprovalsRepository.findLatestWithTx(tx, other.organization.id, proposal.id),
    );
    expect(leaked).toBeNull();
    const access = await runInTenantContext(db, other.organization.id, (tx) =>
      ProposalApprovalsRepository.creatorAccessForProposalWithTx(tx, other.organization.id, proposal.id),
    );
    expect(access).toBeNull();
  });
});
