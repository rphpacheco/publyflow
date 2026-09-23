import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { commercialInquiries } from "@/db/schema/commercial-flow";
import { messages, conversations } from "@/db/schema/conversations-messages";
import { runInTenantContext } from "./tenant-context";
import type { MessageClassification } from "@/lib/ai/schemas";

export type CommercialInquiry = typeof commercialInquiries.$inferSelect;

export type CommercialInquiryWithMessage = CommercialInquiry & {
  messageBody: string;
  messageReceivedAt: Date;
  externalContactLabel: string;
  source: "INSTAGRAM" | "WHATSAPP" | "TIKTOK";
  conversationId: string;
};

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
  organizationId: string,
  inquiryId: string,
  fields: UpdateInquiryStatusFields,
): Promise<CommercialInquiry | null> {
  const [row] = await tx
    .update(commercialInquiries)
    .set(fields)
    .where(and(eq(commercialInquiries.id, inquiryId), eq(commercialInquiries.organizationId, organizationId)))
    .returning();
  return row ?? null;
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
      const [row] = await tx
        .select()
        .from(commercialInquiries)
        .where(
          and(eq(commercialInquiries.id, inquiryId), eq(commercialInquiries.organizationId, organizationId)),
        );
      return row ?? null;
    });
  },

  // Explicit organization predicate, belt-and-suspenders alongside the RLS
  // policy (0006_add_org_id_to_stage_history_and_rls.sql / org_isolation_
  // commercial_inquiries): `id` alone is not org-scoped, so without this
  // predicate a caller in org A could look up an inquiry belonging to org B.
  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<CommercialInquiry | null> {
    const [row] = await tx
      .select()
      .from(commercialInquiries)
      .where(and(eq(commercialInquiries.id, inquiryId), eq(commercialInquiries.organizationId, organizationId)));
    return row ?? null;
  },

  // Returns null (rather than throwing/returning undefined) when no row
  // matched `id` + `organizationId`, so callers (CommercialInquiryService)
  // can surface a clear not-found error instead of silently no-oping.
  async updateStatus(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
    fields: UpdateInquiryStatusFields,
  ): Promise<CommercialInquiry | null> {
    return runInTenantContext(db, organizationId, (tx) => applyStatusUpdate(tx, organizationId, inquiryId, fields));
  },

  async updateStatusWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
    fields: UpdateInquiryStatusFields,
  ): Promise<CommercialInquiry | null> {
    return applyStatusUpdate(tx, organizationId, inquiryId, fields);
  },

  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    status?: CommercialInquiry["status"],
  ): Promise<CommercialInquiryWithMessage[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const conditions = [
        eq(commercialInquiries.organizationId, organizationId),
        eq(commercialInquiries.creatorId, creatorId),
      ];
      if (status) {
        conditions.push(eq(commercialInquiries.status, status));
      }

      const rows = await tx
        .select({
          inquiry: commercialInquiries,
          messageBody: messages.body,
          messageReceivedAt: messages.receivedAt,
          externalContactLabel: conversations.externalContactLabel,
          source: conversations.source,
          conversationId: conversations.id,
        })
        .from(commercialInquiries)
        .innerJoin(messages, eq(messages.id, commercialInquiries.messageId))
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(and(...conditions))
        .orderBy(desc(commercialInquiries.createdAt));

      return rows.map((row) => ({
        ...row.inquiry,
        messageBody: row.messageBody,
        messageReceivedAt: row.messageReceivedAt,
        externalContactLabel: row.externalContactLabel,
        source: row.source,
        conversationId: row.conversationId,
      }));
    });
  },
};
