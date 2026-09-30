import { z } from "zod";

const HANDLE_MESSAGE = "Use só letras, números, ponto e sublinhado (até 30).";
const HANDLE_PATTERN = /^[A-Za-z0-9._]{1,30}$/;

const instagramHandle = z
  .string()
  .nullish()
  .transform((value) => (value ?? "").trim().replace(/^@+/, "").trim())
  .refine((value) => value === "" || HANDLE_PATTERN.test(value), { message: HANDLE_MESSAGE })
  .transform((value) => (value === "" ? null : `@${value}`));

const displayName = z
  .string()
  .trim()
  .min(1, "Informe o nome de exibição.")
  .max(80, "Use no máximo 80 caracteres.");

const email = z.string().trim().toLowerCase().pipe(z.email({ error: "Informe um e-mail válido." }).max(254, "Informe um e-mail válido."));

export const createCreatorSchema = z.object({
  fullName: z.string().trim().min(1, "Informe o nome completo.").max(120, "Use no máximo 120 caracteres."),
  displayName,
  instagramHandle,
  email,
});

export const updateCreatorSchema = z.object({ displayName, instagramHandle, email: email.optional() });

export type CreateCreatorInput = z.output<typeof createCreatorSchema>;
export type UpdateCreatorInput = z.output<typeof updateCreatorSchema>;
