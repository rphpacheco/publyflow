import { z } from "zod";
import { isUuid } from "@/lib/uuid";

const intoField = (message: string) => z.string({ error: message }).refine(isUuid, message);
export const companyMergeSchema = z.object({ into: intoField("Escolha a empresa que fica.") });
export const contactMergeSchema = z.object({ into: intoField("Escolha o contato que fica.") });
