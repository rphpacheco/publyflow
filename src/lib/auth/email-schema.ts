import { z } from "zod";

// Same shape as the `email` field in src/lib/creators/creator-input.ts.
export const emailLinkSchema = z.email({ error: "Informe um e-mail válido." }).max(254, "Informe um e-mail válido.");
