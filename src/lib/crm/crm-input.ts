import { z } from "zod";
import { isUuid } from "@/lib/uuid";

const MAX_MESSAGE = "Use no máximo 200 caracteres.";
const AT_LEAST_ONE = { message: "Informe ao menos um campo.", path: ["form"] };

const requiredText = (emptyMessage: string) => z.string().trim().min(1, emptyMessage).max(200, MAX_MESSAGE);

// Omitted → undefined (column untouched); "" or null → null (column cleared).
const nullableText = z
  .string()
  .trim()
  .max(200, MAX_MESSAGE)
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value ? value : null));

const nullableEmail = nullableText.refine(
  (value) => value === undefined || value === null || z.email().safeParse(value).success,
  "Informe um e-mail válido.",
);

const companyRef = z
  .string()
  .refine(isUuid, "Empresa inválida.")
  .nullable()
  .optional();

const hasAnyField = (input: Record<string, unknown>) => Object.values(input).some((value) => value !== undefined);

function withoutUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

export const updateCompanySchema = z.object({ name: requiredText("Informe o nome da empresa.") });

export const updateContactSchema = z
  .object({
    fullName: requiredText("Informe o nome.").optional(),
    email: nullableEmail,
    phone: nullableText,
    instagramHandle: nullableText,
    companyId: companyRef,
  })
  .refine(hasAnyField, AT_LEAST_ONE)
  .transform(withoutUndefined);

export const updateBrandSchema = z
  .object({
    name: requiredText("Informe o nome da brand.").optional(),
    companyId: companyRef,
  })
  .refine(hasAnyField, AT_LEAST_ONE)
  .transform(withoutUndefined);

export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
