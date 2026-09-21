import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import type { AIService } from "@/lib/ai/ai-service";
import type { MessageClassification } from "@/lib/ai/schemas";
import {
  ConversationsRepository,
  MessagesRepository,
  type Message,
} from "@/repositories/conversations.repository";
import {
  CommercialInquiriesRepository,
  type CommercialInquiry,
} from "@/repositories/commercial-inquiries.repository";

const NON_COMMERCIAL_CATEGORIES = new Set(["FAN", "SPAM"]);

export interface IngestManualMessageInput {
  creatorId: string;
  source: "INSTAGRAM" | "WHATSAPP" | "TIKTOK";
  externalContactLabel: string;
  body: string;
  receivedAt: Date;
}

export interface IngestManualMessageResult {
  message: Message;
  classification: MessageClassification;
  inquiry: CommercialInquiry | null;
}

export const InboxService = {
  async ingestManualMessage(
    db: NodePgDatabase<typeof schema>,
    ai: AIService,
    organizationId: string,
    input: IngestManualMessageInput,
  ): Promise<IngestManualMessageResult> {
    const conversation = await ConversationsRepository.create(db, organizationId, {
      creatorId: input.creatorId,
      source: input.source,
      externalContactLabel: input.externalContactLabel,
    });

    const message = await MessagesRepository.create(db, organizationId, {
      conversationId: conversation.id,
      body: input.body,
      receivedAt: input.receivedAt,
    });

    const classification = await ai.classifyMessage({
      body: input.body,
      source: input.source,
    });

    if (NON_COMMERCIAL_CATEGORIES.has(classification.category)) {
      return { message, classification, inquiry: null };
    }

    const inquiry = await CommercialInquiriesRepository.createFromClassification(
      db,
      organizationId,
      { creatorId: input.creatorId, messageId: message.id, classification },
    );

    return { message, classification, inquiry };
  },
};
