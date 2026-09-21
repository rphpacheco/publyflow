import type { AIService, ClassifyMessageInput } from "./ai-service";
import type { JevService } from "./jev-provider";
import type { OpenAIExtractionService } from "./openai-provider";
import { messageClassificationSchema, type MessageClassification } from "./schemas";

export interface CompositeAIServiceDeps {
  jev: Pick<JevService, "classifyIntent">;
  openai: Pick<OpenAIExtractionService, "extractLeadData">;
}

export function createCompositeAIService(deps: CompositeAIServiceDeps): AIService {
  return {
    async classifyMessage(input: ClassifyMessageInput): Promise<MessageClassification> {
      const [intent, extracted] = await Promise.all([
        deps.jev.classifyIntent(input),
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
