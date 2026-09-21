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

// Shared insert logic, parameterized on an already-open transaction (or
// tenant-context-scoped db handle). Both the standalone `create` methods
// (which open their own single-statement transaction via
// `runInTenantContext`) and callers that need this insert to participate in
// a larger, caller-owned transaction (e.g. `InboxService.ingestManualMessage`,
// which needs conversation + message + commercial inquiry to commit or
// roll back together) go through these.
async function insertConversation(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateConversationInput,
): Promise<Conversation> {
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
}

async function insertMessage(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateMessageInput,
): Promise<Message> {
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
}

export const ConversationsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateConversationInput,
  ): Promise<Conversation> {
    return runInTenantContext(db, organizationId, (tx) => insertConversation(tx, organizationId, input));
  },

  // Same insert, but against a transaction the caller already opened (and
  // already set `app.current_org_id` on, typically via its own
  // `runInTenantContext` call) instead of opening a new one here. Use this
  // when the insert must be atomic with other writes.
  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateConversationInput,
  ): Promise<Conversation> {
    return insertConversation(tx, organizationId, input);
  },
};

export const MessagesRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateMessageInput,
  ): Promise<Message> {
    return runInTenantContext(db, organizationId, (tx) => insertMessage(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateMessageInput,
  ): Promise<Message> {
    return insertMessage(tx, organizationId, input);
  },
};
