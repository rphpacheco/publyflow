import { createJevService } from "./jev-provider";
import { createOpenAIService } from "./openai-provider";
import { createCompositeAIService } from "./composite-provider";

export const ai = createCompositeAIService({
  jev: createJevService(process.env.JEV_API_KEY!),
  openai: createOpenAIService(process.env.OPENAI_API_KEY!),
});
