import { and, count, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalVersions } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";

export type ProposalVersion = typeof proposalVersions.$inferSelect;

export const ProposalVersionsRepository = {
  async countByProposalWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<number> {
    const [{ value }] = await tx
      .select({ value: count() })
      .from(proposalVersions)
      .where(and(eq(proposalVersions.proposalId, proposalId), eq(proposalVersions.organizationId, organizationId)));
    return value;
  },

  async insertWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    versionNumber: number,
    snapshotJson: unknown,
    createdBy: string,
  ): Promise<ProposalVersion> {
    const [version] = await tx
      .insert(proposalVersions)
      .values({ organizationId, proposalId, versionNumber, snapshotJson, createdBy })
      .returning();
    return version;
  },

  async listByProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalVersion[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(proposalVersions)
        .where(and(eq(proposalVersions.organizationId, organizationId), eq(proposalVersions.proposalId, proposalId)));
    });
  },
};
