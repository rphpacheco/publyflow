import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalResponses } from "@/db/schema/proposals";

export type ProposalResponse = typeof proposalResponses.$inferSelect;

export interface InsertResponseInput {
  publicationId: string;
  action: ProposalResponse["action"];
  respondentName: string;
  respondentEmail: string;
  message: string | null;
}

export const ProposalResponsesRepository = {
  /** Insert-only; the unique publication_id enforces one response per publication. */
  async insertWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, input: InsertResponseInput): Promise<ProposalResponse> {
    const [response] = await tx
      .insert(proposalResponses)
      .values({ organizationId, ...input })
      .returning();
    return response;
  },

  async findByPublicationWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, publicationId: string): Promise<ProposalResponse | null> {
    const [response] = await tx
      .select()
      .from(proposalResponses)
      .where(and(eq(proposalResponses.publicationId, publicationId), eq(proposalResponses.organizationId, organizationId)));
    return response ?? null;
  },
};
