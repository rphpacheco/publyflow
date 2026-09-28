import type { AIService, ClassifyMessageInput } from "./ai-service";
import type { JevService } from "./jev-provider";
import type { OpenAIExtractionService } from "./openai-provider";
import { messageClassificationSchema, type IntentClassification, type MessageClassification } from "./schemas";

export interface CompositeAIServiceDeps {
  jev: Pick<JevService, "classifyIntent">;
  openai: Pick<OpenAIExtractionService, "extractLeadData" | "classifyIntent">;
}

export function createCompositeAIService(deps: CompositeAIServiceDeps): AIService {
  // Jev is a new, lightly proven vendor on the product's most-used flow; if
  // it fails, OpenAI classifies instead so one provider can't block the inbox.
  async function classifyIntent(input: ClassifyMessageInput): Promise<IntentClassification> {
    try {
      return await deps.jev.classifyIntent(input);
    } catch (error) {
      console.warn("Jev classification failed; falling back to OpenAI", error);
      return deps.openai.classifyIntent(input);
    }
  }

  return {
    async classifyMessage(input: ClassifyMessageInput): Promise<MessageClassification> {
      const [intent, extracted] = await Promise.all([
        classifyIntent(input),
        deps.openai.extractLeadData(input),
      ]);

      return messageClassificationSchema.parse({
        category: intent.category,
        commercialScore: intent.commercialScore,
        intent: intent.intent,
        extracted,
      });
    },
  };
}
