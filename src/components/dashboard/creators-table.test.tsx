// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CreatorsTable } from "./creators-table";

const creators = [
  { creatorId: "a", name: "Ana", openOpportunities: 1, proposalsSent: 2, wonCount: 3, wonCents: 40000, approvalRate: 0.75 },
  { creatorId: "b", name: "Bia", openOpportunities: 0, proposalsSent: 0, wonCount: 0, wonCents: 0, approvalRate: null },
];

describe("CreatorsTable", () => {
  it("renders rows in order with formatted values", () => {
    render(<CreatorsTable creators={creators} />);
    const rows = screen.getAllByRole("row");
    expect(rows[1].textContent).toContain("Ana");
    expect(rows[2].textContent).toContain("Bia");
    expect(rows[1].textContent).toMatch(/3 · R\$\s400,00/);
    expect(rows[1].textContent).toContain("75%");
    expect(rows[2].textContent).toContain("—");
  });
  it("shows empty state", () => {
    render(<CreatorsTable creators={[]} />);
    expect(screen.getByText("Nenhum creator cadastrado.")).toBeTruthy();
  });
});
