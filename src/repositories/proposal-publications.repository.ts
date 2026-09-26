import { and, desc, eq, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalPublications, proposalResponses } from "@/db/schema/proposals";
import type { PublicationContextJson } from "@/lib/presentation/snapshot-schema";
import type { ProposalResponse } from "./proposal-responses.repository";

export type ProposalPublication = typeof proposalPublications.$inferSelect;

export interface InsertPublicationInput {
  proposalId: string;
  versionId: string;
  versionNumber: number;
  context: PublicationContextJson;
  publishedBy: string;
  publishedAt: Date;
}

export const ProposalPublicationsRepository = {
  /** Caller must hold the proposal row lock (numbers are max + 1). Publications are insert-only. */
  async insertWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, input: InsertPublicationInput): Promise<ProposalPublication> {
    const [{ current }] = await tx
      .select({ current: max(proposalPublications.publicationNumber) })
      .from(proposalPublications)
      .where(and(eq(proposalPublications.proposalId, input.proposalId), eq(proposalPublications.organizationId, organizationId)));
    const [publication] = await tx
      .insert(proposalPublications)
      .values({ organizationId, publicationNumber: (current ?? 0) + 1, ...input })
      .returning();
    return publication;
  },

  async findLatestWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string): Promise<ProposalPublication | null> {
    const [publication] = await tx
      .select()
      .from(proposalPublications)
      .where(and(eq(proposalPublications.proposalId, proposalId), eq(proposalPublications.organizationId, organizationId)))
      .orderBy(desc(proposalPublications.publicationNumber))
      .limit(1);
    return publication ?? null;
  },

  /** Scoped to one proposal: a publication of another proposal is never found. */
  async findForProposalWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    publicationId: string,
  ): Promise<ProposalPublication | null> {
    const [publication] = await tx
      .select()
      .from(proposalPublications)
      .where(
        and(
          eq(proposalPublications.id, publicationId),
          eq(proposalPublications.proposalId, proposalId),
          eq(proposalPublications.organizationId, organizationId),
        ),
      );
    return publication ?? null;
  },

  async listWithResponsesWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<Array<{ publication: ProposalPublication; response: ProposalResponse | null }>> {
    const rows = await tx
      .select({ publication: proposalPublications, response: proposalResponses })
      .from(proposalPublications)
      .leftJoin(proposalResponses, eq(proposalResponses.publicationId, proposalPublications.id))
      .where(and(eq(proposalPublications.proposalId, proposalId), eq(proposalPublications.organizationId, organizationId)))
      .orderBy(desc(proposalPublications.publicationNumber));
    return rows.map((row) => ({ publication: row.publication, response: row.response ?? null }));
  },
};
