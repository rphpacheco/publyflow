import { eq } from "drizzle-orm";
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

export type UpdateInquiryStatusFields = Partial<{
  status: CommercialInquiry["status"];
  convertedLeadId: string | null;
  linkedOpportunityId: string | null;
}>;

// Same split-out pattern as insertInquiry above: `updateStatus` opens its
// own transaction, `updateStatusWithTx` lets a caller (e.g.
// CommercialInquiryService.resolve) fold this update into a larger,
// caller-owned transaction so it commits or rolls back with the sibling
// Lead/Opportunity writes.
async function applyStatusUpdate(
  tx: NodePgDatabase<typeof schema>,
  inquiryId: string,
  fields: UpdateInquiryStatusFields,
): Promise<CommercialInquiry> {
  const [row] = await tx
    .update(commercialInquiries)
    .set(fields)
    .where(eq(commercialInquiries.id, inquiryId))
    .returning();
  return row;
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

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<CommercialInquiry | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.select().from(commercialInquiries).where(eq(commercialInquiries.id, inquiryId));
      return row ?? null;
    });
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    _organizationId: string,
    inquiryId: string,
  ): Promise<CommercialInquiry | null> {
    const [row] = await tx.select().from(commercialInquiries).where(eq(commercialInquiries.id, inquiryId));
    return row ?? null;
  },

  async updateStatus(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
    fields: UpdateInquiryStatusFields,
  ): Promise<CommercialInquiry> {
    return runInTenantContext(db, organizationId, (tx) => applyStatusUpdate(tx, inquiryId, fields));
  },

  async updateStatusWithTx(
    tx: NodePgDatabase<typeof schema>,
    _organizationId: string,
    inquiryId: string,
    fields: UpdateInquiryStatusFields,
  ): Promise<CommercialInquiry> {
    return applyStatusUpdate(tx, inquiryId, fields);
  },
};
