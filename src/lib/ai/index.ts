import type { AIService } from "./ai-service";
import { createJevService } from "./jev-provider";
import { createOpenAIService } from "./openai-provider";
import { createCompositeAIService } from "./composite-provider";
import { AiNotConfiguredError } from "./errors";

let instance: AIService | null = null;

// Built on first use so importing a route never crashes when a key is absent (local dev).
function getService(): AIService {
  if (instance) return instance;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new AiNotConfiguredError("OPENAI_API_KEY");
  const jevKey = process.env.JEV_API_KEY;
  instance = createCompositeAIService({
    jev: jevKey ? createJevService(jevKey) : null,
    openai: createOpenAIService(openaiKey),
  });
  return instance;
}

export const ai: AIService = {
  classifyMessage: async (input) => getService().classifyMessage(input),
};
export { AiNotConfiguredError };
