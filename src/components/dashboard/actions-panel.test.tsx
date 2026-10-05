// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionsPanel } from "./actions-panel";
import type { DashboardActionsDto } from "@/hooks/use-dashboard";

const base: DashboardActionsDto = {
  untriagedInquiries: 2, clientChangesRequested: 0, creatorChangesRequested: 1,
  awaitingCreatorApproval: 3, readyToSend: 4, awaitingClient: 5,
};

describe("ActionsPanel", () => {
  it("renders rows with links", () => {
    render(<ActionsPanel actions={base} />);
    expect(screen.getByText("Requer ação")).toBeTruthy();
    expect(screen.getByText("Acompanhamento")).toBeTruthy();
    expect(screen.getByText("Mensagens sem triagem").closest("a")?.getAttribute("href")).toBe("/inbox");
    for (const label of ["Ajustes pedidos pelo cliente", "Ajustes pedidos pelo creator", "Aguardando aprovação do creator", "Prontas para enviar", "Aguardando resposta do cliente"]) {
      expect(screen.getByText(label).closest("a")?.getAttribute("href")).toBe("/proposals");
    }
    expect(screen.queryByText("Tudo em dia")).toBeNull();
  });
  it("marks zero rows", () => {
    render(<ActionsPanel actions={base} />);
    expect(screen.getByText("Ajustes pedidos pelo cliente").closest("a")?.getAttribute("data-zero")).toBe("true");
    expect(screen.getByText("Prontas para enviar").closest("a")?.getAttribute("data-zero")).toBe("false");
  });
  it("shows Tudo em dia with an icon when all clear", () => {
    render(<ActionsPanel actions={{ ...base, untriagedInquiries: 0, creatorChangesRequested: 0, awaitingCreatorApproval: 0, readyToSend: 0 }} />);
    expect(screen.getByText("Tudo em dia").closest("p")?.querySelector("svg")).toBeTruthy();
  });
  it("shows exact counts, with no 200+ cap", () => {
    render(<ActionsPanel actions={{ ...base, readyToSend: 250, awaitingClient: 7 }} />);
    expect(screen.getByText("250")).toBeTruthy();
    expect(screen.queryByText("200+")).toBeNull();
    expect(screen.getByText("7")).toBeTruthy();
  });
});
