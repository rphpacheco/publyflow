import OpenAI from "openai";
import type { ClassifyMessageInput } from "./ai-service";
import {
  extractedFieldsSchema,
  intentClassificationSchema,
  messageCategoryEnum,
  type ExtractedFields,
  type IntentClassification,
} from "./schemas";

const MODEL = "gpt-4o-mini";

const EXTRACTION_PROMPT = `Você extrai dados estruturados de mensagens comerciais recebidas
por uma creator. Nunca invente informações que não estão no texto — quando um dado não
estiver disponível, use null.`;

const CLASSIFICATION_PROMPT = `Você classifica mensagens recebidas por uma creator de conteúdo.
Escolha a categoria, dê um Commercial Score de 0 a 100 (a probabilidade de a mensagem ser
de uma marca ou empresa querendo contratá-la) e resuma a intenção em poucas palavras, ou
null se não houver uma intenção clara.`;

const nullableString = { type: ["string", "null"] };

const EXTRACTION_FIELDS = [
  "companyName",
  "brandName",
  "contactName",
  "email",
  "phone",
  "budget",
  "deliverables",
] as const;

// Structured Outputs: the model must return exactly these keys, so the zod
// parse below validates values rather than guessing at key names.
const EXTRACTION_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "lead_data",
    strict: true,
    schema: {
      type: "object",
      properties: Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, nullableString])),
      required: [...EXTRACTION_FIELDS],
      additionalProperties: false,
    },
  },
} as const;

const CLASSIFICATION_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "message_classification",
    strict: true,
    schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: messageCategoryEnum.options },
        commercialScore: { type: "integer", minimum: 0, maximum: 100 },
        intent: nullableString,
      },
      required: ["category", "commercialScore", "intent"],
      additionalProperties: false,
    },
  },
} as const;

export interface OpenAIExtractionService {
  extractLeadData(input: ClassifyMessageInput): Promise<ExtractedFields>;
  /** Fallback classifier, used when Jev is unavailable. */
  classifyIntent(input: ClassifyMessageInput): Promise<IntentClassification>;
}

export function createOpenAIService(apiKey: string): OpenAIExtractionService {
  const client = new OpenAI({ apiKey });

  async function complete(
    systemPrompt: string,
    input: ClassifyMessageInput,
    responseFormat: OpenAI.ResponseFormatJSONSchema,
  ): Promise<unknown> {
    const response = await client.chat.completions.create({
      model: MODEL,
      response_format: responseFormat,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Origem: ${input.source}\nMensagem: ${input.body}` },
      ],
    });
    return JSON.parse(response.choices[0]?.message?.content ?? "{}");
  }

  return {
    async extractLeadData(input: ClassifyMessageInput): Promise<ExtractedFields> {
      return extractedFieldsSchema.parse(await complete(EXTRACTION_PROMPT, input, EXTRACTION_FORMAT));
    },

    async classifyIntent(input: ClassifyMessageInput): Promise<IntentClassification> {
      return intentClassificationSchema.parse(await complete(CLASSIFICATION_PROMPT, input, CLASSIFICATION_FORMAT));
    },
  };
}
