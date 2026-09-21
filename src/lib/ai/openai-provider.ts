import OpenAI from "openai";
import type { ClassifyMessageInput } from "./ai-service";
import { extractedFieldsSchema, type ExtractedFields } from "./schemas";

const EXTRACTION_PROMPT = `Você extrai dados estruturados de mensagens comerciais recebidas
por uma creator. Retorne APENAS um JSON válido no formato especificado. Nunca invente
informações que não estão no texto — quando um dado não estiver disponível, use null.`;

export interface OpenAIExtractionService {
  extractLeadData(input: ClassifyMessageInput): Promise<ExtractedFields>;
}

export function createOpenAIService(apiKey: string): OpenAIExtractionService {
  const client = new OpenAI({ apiKey });

  return {
    async extractLeadData(input: ClassifyMessageInput): Promise<ExtractedFields> {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          {
            role: "user",
            content: `Origem: ${input.source}\nMensagem: ${input.body}`,
          },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      return extractedFieldsSchema.parse(JSON.parse(raw));
    },
  };
}
