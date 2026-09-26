import { describe, it, expect } from "vitest";
import {
  PROPOSAL_THEMES,
  PROPOSAL_THEME_LABELS,
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_STATUS_BADGE_VARIANT,
  PUBLIC_PROPOSAL_STATUSES,
} from "./proposal-themes";

describe("proposal themes", () => {
  it("lists all 6 themes with a Portuguese label each", () => {
    expect(PROPOSAL_THEMES).toEqual(["PREMIUM", "MINIMAL", "EDITORIAL", "FASHION", "BEAUTY", "CORPORATE"]);
    for (const theme of PROPOSAL_THEMES) {
      expect(PROPOSAL_THEME_LABELS[theme]).toBeTruthy();
    }
    expect(PROPOSAL_THEME_LABELS.PREMIUM).toBe("Premium");
    expect(PROPOSAL_THEME_LABELS.MINIMAL).toBe("Minimalista");
  });

  it("labels every proposal status in Portuguese with a badge variant", () => {
    expect(PROPOSAL_STATUS_LABELS).toEqual({
      DRAFT: "Rascunho",
      ARCHIVED: "Arquivada",
      SENT: "Enviada",
      CHANGES_REQUESTED: "Ajustes pedidos",
      APPROVED: "Aceita",
      REJECTED: "Recusada",
    });
    expect(PROPOSAL_STATUS_BADGE_VARIANT).toEqual({
      DRAFT: "default",
      ARCHIVED: "default",
      SENT: "info",
      CHANGES_REQUESTED: "warning",
      APPROVED: "success",
      REJECTED: "error",
    });
    expect(PUBLIC_PROPOSAL_STATUSES).toEqual(["SENT", "CHANGES_REQUESTED", "APPROVED", "REJECTED"]);
  });
});
