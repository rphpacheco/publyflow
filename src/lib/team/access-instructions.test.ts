import { describe, it, expect } from "vitest";
import { buildTeamAccessInstructions } from "./access-instructions";

describe("buildTeamAccessInstructions", () => {
  it("builds the login url and the invite message", () => {
    const result = buildTeamAccessInstructions({
      fullName: "Ana Lima",
      organizationName: "Agência X",
      email: "ana@x.test",
      origin: "https://publyflow.vercel.app",
    });
    expect(result.loginUrl).toBe("https://publyflow.vercel.app/login");
    expect(result.message).toBe(
      "Olá, Ana Lima! Você foi convidado(a) para a equipe da Agência X no PublyFlow. Acesse https://publyflow.vercel.app/login e entre com Google ou com um link enviado para ana@x.test.",
    );
  });
});
