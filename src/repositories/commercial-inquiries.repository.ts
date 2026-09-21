import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { commercialInquiries } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "./tenant-context";
import type { MessageClassification } from "@/lib/ai/schemas";

export type CommercialInquiry = typeof commercialInquiries.$inferSelect;

export const CommercialInquiriesRepository = {
  async createFromClassification(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: { creatorId: string; messageId: string; classification: MessageClassification },
  ): Promise<CommercialInquiry> {
    return runInTenantContext(db, organizationId, async (tx) => {
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
    });
  },
};
