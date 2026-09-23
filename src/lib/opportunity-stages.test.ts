import { describe, it, expect } from "vitest";
import { STAGES, STAGE_LABELS } from "./opportunity-stages";

describe("opportunity stages", () => {
  it("lists all 10 stages in pipeline order", () => {
    expect(STAGES).toEqual([
      "NOVO_LEAD",
      "QUALIFICACAO",
      "PRIMEIRO_CONTATO",
      "MIDIA_KIT_ENVIADO",
      "PROPOSTA_SOLICITADA",
      "PROPOSTA_ENVIADA",
      "NEGOCIACAO",
      "AGUARDANDO_CLIENTE",
      "FECHADO",
      "PERDIDO",
    ]);
  });

  it("has a Portuguese label for every stage", () => {
    for (const stage of STAGES) {
      expect(STAGE_LABELS[stage]).toBeTruthy();
    }
    expect(STAGE_LABELS.NOVO_LEAD).toBe("Novo Lead");
    expect(STAGE_LABELS.FECHADO).toBe("Fechado");
  });
});
