import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { commercialInquiries, conversations, messages } from "@/db/schema";

/** conversation → message → commercial_inquiry with a given status/createdAt. */
export async function seedInquiry(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  creatorId: string,
  status: "NEW" | "CONVERTED" | "DISCARDED",
  createdAt: string,
) {
  const [conversation] = await db
    .insert(conversations)
    .values({ organizationId, creatorId, source: "INSTAGRAM", externalContactLabel: "@cliente" })
    .returning();
  const [message] = await db
    .insert(messages)
    .values({ organizationId, conversationId: conversation.id, body: "Oi, quero uma proposta", receivedAt: new Date(createdAt) })
    .returning();
  await db.insert(commercialInquiries).values({ organizationId, creatorId, messageId: message.id, status, createdAt: new Date(createdAt) });
}
