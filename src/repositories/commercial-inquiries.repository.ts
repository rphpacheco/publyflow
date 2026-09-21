import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { commercialInquiries } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "./tenant-context";
import type { MessageClassification } from "@/lib/ai/schemas";

export type CommercialInquiry = typeof commercialInquiries.$inferSelect;

export interface CreateInquiryFromClassificationInput {
  creatorId: string;
  messageId: string;
  classification: MessageClassification;
}

// See conversations.repository.ts for why this is split out: it lets both the
// standalone `createFromClassification` (own transaction) and
// `createFromClassificationWithTx` (caller-supplied transaction, so the
// insert can be atomic with sibling writes) share one insert implementation.
async function insertInquiry(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateInquiryFromClassificationInput,
): Promise<CommercialInquiry> {
  const [inquiry] = await tx
    .insert(commercialInquiries)
    .values({
      organizationId,
      creatorId: input.creatorId,
      messageId: input.messageId,
      status: "NEW",
      companyGuess: input.classification.extracted.companyName,
      brandGuess: input.classification.extracted.brandName,
      contactNameGuess: input.classification.extracted.contactName,
      budgetGuess: input.classification.extracted.budget,
      intentGuess: input.classification.intent,
    })
    .returning();
  return inquiry;
}

export const CommercialInquiriesRepository = {
  async createFromClassification(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateInquiryFromClassificationInput,
  ): Promise<CommercialInquiry> {
    return runInTenantContext(db, organizationId, (tx) => insertInquiry(tx, organizationId, input));
  },

  async createFromClassificationWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateInquiryFromClassificationInput,
  ): Promise<CommercialInquiry> {
    return insertInquiry(tx, organizationId, input);
  },
};
