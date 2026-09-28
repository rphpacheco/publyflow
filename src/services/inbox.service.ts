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
import { runInTenantContext } from "@/repositories/tenant-context";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { CreatorNotFoundError } from "@/domain/creators/errors";
import { MessageClassificationError } from "@/domain/inbox/errors";

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
    // Classification is a network call, not a DB write — run it before
    // opening the transaction below so we're never holding a Postgres
    // transaction open across an external HTTP round trip. It only depends
    // on `body`/`source` from the input, not on the conversation/message
    // rows, so reordering it ahead of the inserts is safe.
    let classification: MessageClassification;
    try {
      classification = await ai.classifyMessage({
        body: input.body,
        source: input.source,
      });
    } catch (error) {
      throw new MessageClassificationError(error);
    }

    // Conversation + message + (conditionally) commercial inquiry must
    // commit or roll back together: a message with no inquiry is fine (FAN/
    // SPAM), but a message that exists only because an inquiry insert
    // failed partway through would be orphaned state. So all three writes
    // share this one transaction/tenant-context.
    return runInTenantContext(db, organizationId, async (tx) => {
      const creatorExists = await CreatorsRepository.existsForOrganizationWithTx(
        tx,
        organizationId,
        input.creatorId,
      );
      if (!creatorExists) {
        throw new CreatorNotFoundError(input.creatorId);
      }

      const conversation = await ConversationsRepository.createWithTx(tx, organizationId, {
        creatorId: input.creatorId,
        source: input.source,
        externalContactLabel: input.externalContactLabel,
      });

      const message = await MessagesRepository.createWithTx(tx, organizationId, {
        conversationId: conversation.id,
        body: input.body,
        receivedAt: input.receivedAt,
      });

      if (NON_COMMERCIAL_CATEGORIES.has(classification.category)) {
        return { message, classification, inquiry: null };
      }

      const inquiry = await CommercialInquiriesRepository.createFromClassificationWithTx(
        tx,
        organizationId,
        { creatorId: input.creatorId, messageId: message.id, classification },
      );

      return { message, classification, inquiry };
    });
  },
};
