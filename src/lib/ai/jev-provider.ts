import type { ClassifyMessageInput } from "./ai-service";
import { intentClassificationSchema, type IntentClassification, type MessageCategory } from "./schemas";

// Jev (typesafe.ai) answers typed questions about a piece of content:
// POST /v1/systemone { model, state, questions } → { answers, usage }.
// Spec: https://api.typesafe.ai/openapi.json
const JEV_API_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";

const CATEGORY_CRITERIA: Record<MessageCategory, string> = {
  FAN: "Mensagem de fã ou seguidor, sem intenção comercial",
  COMMERCIAL_LEAD: "Marca ou empresa interessada em contratar a creator (publi, campanha, proposta, valores)",
  EXISTING_CLIENT: "Cliente que já trabalha com a creator falando de uma campanha em andamento",
  AGENCY: "Agência de marketing ou talentos entrando em contato",
  PRESS: "Imprensa, jornalista ou veículo de mídia",
  PARTNERSHIP: "Proposta de parceria ou permuta sem pagamento em dinheiro",
  SPAM: "Spam, golpe ou mensagem automática",
  OTHER: "Qualquer outro assunto",
};

interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

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
          model: JEV_MODEL,
          state: `Origem: ${input.source}\nMensagem: ${input.body}`,
          questions: {
            category: {
              type: "choice",
              instructions: "Qual é a categoria desta mensagem recebida por uma creator de conteúdo?",
              criteria: CATEGORY_CRITERIA,
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Jev classification failed with status ${response.status}`);
      }

      const payload = await response.json();
      const answer = payload.answers?.category as ChoiceAnswer | undefined;
      return intentClassificationSchema.parse({
        category: answer?.choice,
        // Commercial Score = how likely the message is a paying lead, not how
        // sure Jev is about whichever category it picked.
        commercialScore: Math.round((answer?.probabilities?.COMMERCIAL_LEAD ?? 0) * 100),
        intent: null,
      });
    },
  };
}
