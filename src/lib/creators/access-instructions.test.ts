import { describe, it, expect } from "vitest";
import { buildAccessInstructions } from "./access-instructions";

describe("buildAccessInstructions", () => {
  it("builds the login URL and the exact message", () => {
    expect(
      buildAccessInstructions({ displayName: "Thais", email: "thais@x.com", origin: "https://publyflow.vercel.app" }),
    ).toEqual({
      loginUrl: "https://publyflow.vercel.app/login",
      message:
        "Olá, Thais! Você foi convidado(a) para acompanhar suas propostas no PublyFlow. Acesse https://publyflow.vercel.app/login e entre com Google ou com um link enviado para thais@x.com.",
    });
  });
});
