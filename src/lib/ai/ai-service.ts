import type { MessageClassification } from "./schemas";

export interface ClassifyMessageInput {
  body: string;
  source: string;
}

export interface AIService {
  classifyMessage(input: ClassifyMessageInput): Promise<MessageClassification>;
}
