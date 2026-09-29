import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createCreatorSchema, updateCreatorSchema } from "./creator-input";

const base = { fullName: "Thais Rocha", displayName: "Thais", email: " Thais@Example.COM ", instagramHandle: null };
const fieldErrors = <T>(result: { error?: z.ZodError<T> }) => z.flattenError(result.error!).fieldErrors;

describe("creator input", () => {
  it("normalises e-mail and instagram handle", () => {
    expect(createCreatorSchema.parse({ ...base, instagramHandle: " @Thais.Rocha " })).toEqual({
      fullName: "Thais Rocha",
      displayName: "Thais",
      email: "thais@example.com",
      instagramHandle: "@Thais.Rocha",
    });
    expect(createCreatorSchema.parse({ ...base, instagramHandle: "" }).instagramHandle).toBeNull();
    expect(createCreatorSchema.parse({ ...base, instagramHandle: undefined }).instagramHandle).toBeNull();
  });

  it("rejects invalid handles with the Portuguese message", () => {
    for (const handle of ["thais rocha", "a".repeat(31), "thais!"]) {
      const result = createCreatorSchema.safeParse({ ...base, instagramHandle: handle });
      expect(result.success).toBe(false);
      expect(fieldErrors(result).instagramHandle).toEqual(["Use só letras, números, ponto e sublinhado (até 30)."]);
    }
  });

  it("requires names and a valid e-mail", () => {
    const result = createCreatorSchema.safeParse({ fullName: " ", displayName: "", email: "x@y", instagramHandle: null });
    expect(fieldErrors(result)).toEqual({
      fullName: ["Informe o nome completo."],
      displayName: ["Informe o nome de exibição."],
      email: ["Informe um e-mail válido."],
    });
    const long = createCreatorSchema.safeParse({ ...base, fullName: "a".repeat(121), displayName: "b".repeat(81) });
    expect(fieldErrors(long)).toEqual({
      fullName: ["Use no máximo 120 caracteres."],
      displayName: ["Use no máximo 80 caracteres."],
    });
  });

  it("update ignores e-mail", () => {
    expect(updateCreatorSchema.parse({ displayName: "T", instagramHandle: "thais", email: "x@y.z" })).toEqual({
      displayName: "T",
      instagramHandle: "@thais",
    });
  });
});
