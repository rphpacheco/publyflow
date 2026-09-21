import { z } from "zod";

export const messageCategoryEnum = z.enum([
  "FAN",
  "COMMERCIAL_LEAD",
  "EXISTING_CLIENT",
  "AGENCY",
  "PRESS",
  "PARTNERSHIP",
  "SPAM",
  "OTHER",
]);

export type MessageCategory = z.infer<typeof messageCategoryEnum>;

export const extractedFieldsSchema = z.object({
  companyName: z.string().nullable(),
  brandName: z.string().nullable(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  budget: z.string().nullable(),
  deliverables: z.string().nullable(),
});

export type ExtractedFields = z.infer<typeof extractedFieldsSchema>;

export const intentClassificationSchema = z.object({
  category: messageCategoryEnum,
  commercialScore: z.number().min(0).max(100),
  intent: z.string().nullable(),
});

export type IntentClassification = z.infer<typeof intentClassificationSchema>;

export const messageClassificationSchema = intentClassificationSchema.extend({
  extracted: extractedFieldsSchema,
});

export type MessageClassification = z.infer<typeof messageClassificationSchema>;
