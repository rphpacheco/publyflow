import { z } from "zod";

export const inviteManagerSchema = z.object({
  fullName: z.string().trim().min(1, "Informe o nome.").max(200, "Informe o nome."),
  email: z
    .string()
    .trim()
    .pipe(z.email({ error: "Informe um e-mail válido." }).max(254, "Informe um e-mail válido.")),
});
