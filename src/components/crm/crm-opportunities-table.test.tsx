// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CrmOpportunitiesTable } from "./crm-opportunities-table";

describe("CrmOpportunitiesTable", () => {
  it("shows brand, creator, stage label, BRL value and proposal links", () => {
    render(
      <CrmOpportunitiesTable
        opportunities={[
          {
            id: "o1",
            brandName: "Linha Verão",
            creatorName: "Thais",
            stage: "PROPOSTA_ENVIADA",
            status: "OPEN",
            estimatedValueCents: 150000,
            createdAt: "2026-10-01T00:00:00.000Z",
            proposals: [{ id: "p1", title: "Campanha Verão", status: "SENT" }],
          },
        ]}
      />,
    );
    expect(screen.getByText("Linha Verão")).toBeTruthy();
    expect(screen.getByText("Thais")).toBeTruthy();
    expect(screen.getByText(/R\$\s?1\.500,00/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Campanha Verão" }).getAttribute("href")).toBe("/proposals/p1");
  });

  it("shows an empty message without opportunities", () => {
    render(<CrmOpportunitiesTable opportunities={[]} />);
    expect(screen.getByText("Nenhuma oportunidade.")).toBeTruthy();
  });
});
