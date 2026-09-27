// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-proposal-share-info", () => ({
  useProposalShareInfo: () => ({
    data: { proposalTitle: "Campanha Verão", creatorName: "Thais", contact: { name: "Maria Fernandes", phone: "(11) 98765-4321", email: "maria@bella.test" } },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProposalShareActions } from "./proposal-share-actions";

describe("ProposalShareActions", () => {
  it("links WhatsApp and e-mail with the prepared message", () => {
    render(<ProposalShareActions proposalId="p1" publicPath="/p/tok" />);
    const url = `${window.location.origin}/p/tok`;
    const message = `Olá, Maria! Segue a proposta "Campanha Verão" de Thais: ${url}`;

    const whatsapp = screen.getByRole("link", { name: "WhatsApp" });
    expect(whatsapp).toHaveAttribute("href", `https://wa.me/5511987654321?text=${encodeURIComponent(message)}`);
    expect(whatsapp).toHaveAttribute("target", "_blank");
    expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");

    expect(screen.getByRole("link", { name: "E-mail" })).toHaveAttribute(
      "href",
      `mailto:${encodeURIComponent("maria@bella.test")}?subject=${encodeURIComponent("Proposta: Campanha Verão")}&body=${encodeURIComponent(message)}`,
    );
    expect(screen.getByRole("button", { name: "Copiar mensagem" })).toBeInTheDocument();
  });
});
