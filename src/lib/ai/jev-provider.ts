import type { ClassifyMessageInput } from "./ai-service";
import { intentClassificationSchema, type IntentClassification } from "./schemas";

const JEV_API_URL = "https://api.typesafe.ai/v1/decisions";

export interface JevService {
  classifyIntent(input: ClassifyMessageInput): Promise<IntentClassification>;
}

export function createJevService(apiKey: string): JevService {
  return {
    async classifyIntent(input: ClassifyMessageInput): Promise<IntentClassification> {
      const response = await fetch(JEV_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          task: "message-intent-classification",
          categories: [
            "FAN",
            "COMMERCIAL_LEAD",
            "EXISTING_CLIENT",
            "AGENCY",
            "PRESS",
            "PARTNERSHIP",
            "SPAM",
            "OTHER",
          ],
          input: `Origem: ${input.source}\nMensagem: ${input.body}`,
        }),
      });

      if (!response.ok) {
        throw new Error(`Jev classification failed with status ${response.status}`);
      }

      const payload = await response.json();
      return intentClassificationSchema.parse({
        category: payload.decision,
        commercialScore: Math.round(payload.confidence * 100),
        intent: payload.metadata?.intent ?? null,
      });
    },
  };
}
