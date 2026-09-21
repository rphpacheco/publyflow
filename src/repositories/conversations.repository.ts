import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { conversations, messages } from "@/db/schema/conversations-messages";
import { runInTenantContext } from "./tenant-context";

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

export interface CreateConversationInput {
  creatorId: string;
  source: "INSTAGRAM" | "WHATSAPP" | "TIKTOK";
  externalContactLabel: string;
}

export interface CreateMessageInput {
  conversationId: string;
  body: string;
  receivedAt: Date;
}

export const ConversationsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateConversationInput,
  ): Promise<Conversation> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [conversation] = await tx
        .insert(conversations)
        .values({
          organizationId,
          creatorId: input.creatorId,
          source: input.source,
          externalContactLabel: input.externalContactLabel,
        })
        .returning();
      return conversation;
    });
  },
};

export const MessagesRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateMessageInput,
  ): Promise<Message> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [message] = await tx
        .insert(messages)
        .values({
          organizationId,
          conversationId: input.conversationId,
          body: input.body,
          receivedAt: input.receivedAt,
        })
        .returning();
      return message;
    });
  },
};
