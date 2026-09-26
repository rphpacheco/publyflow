// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProposalStatusBadge } from "./proposal-status-badge";

describe("ProposalStatusBadge", () => {
  it.each([
    ["SENT", "Enviada", "text-info"],
    ["APPROVED", "Aceita", "text-success"],
    ["REJECTED", "Recusada", "text-error"],
    ["CHANGES_REQUESTED", "Ajustes pedidos", "text-warning"],
  ] as const)("%s", (status, label, colorClass) => {
    render(<ProposalStatusBadge status={status} />);
    expect(screen.getByText(label).className).toContain(colorClass);
  });
});
