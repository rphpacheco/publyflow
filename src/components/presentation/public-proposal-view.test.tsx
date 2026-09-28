// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PresentationModel } from "@/lib/presentation/types";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { PublicProposalView } from "./public-proposal-view";

const model: PresentationModel = {
  theme: "MINIMAL",
  title: "Campanha",
  headline: "Verão com Bella",
  body: null,
  creator: { name: "Thais", handle: "@thais" },
  clientName: "Bella Cosméticos",
  items: [],
  totalCents: 0,
  totalLabel: "R$ 0,00",
  issuedAtLabel: "25 de setembro de 2026",
};

function renderView(overrides: Partial<React.ComponentProps<typeof PublicProposalView>> = {}) {
  return render(
    <PublicProposalView
      token={"t".repeat(43)}
      model={model}
      publicationId="pub1"
      versionNumber={3}
      publishedAtLabel="25 de setembro de 2026"
      response={null}
      {...overrides}
    />,
  );
}

describe("PublicProposalView", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("accepting asks for name and e-mail, posts the response and refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ response: {} }), { status: 201 }));
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    expect(screen.getByText("Você está aceitando a versão 3 desta proposta, enviada em 25 de setembro de 2026.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nome"), "Maria");
    await userEvent.type(screen.getByLabelText("E-mail"), "maria@bella.test");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(fetchMock).toHaveBeenCalledWith(`/api/public/proposals/${"t".repeat(43)}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicationId: "pub1", action: "ACCEPT", name: "Maria", email: "maria@bella.test", message: null }),
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("requesting changes requires a message", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Pedir ajustes" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Maria");
    await userEvent.type(screen.getByLabelText("E-mail"), "maria@bella.test");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(screen.getByText("Descreva os ajustes que você gostaria.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejecting has an optional reason", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "Recusar" }));
    expect(screen.getByLabelText("Motivo (opcional)")).toBeInTheDocument();
  });

  it("SUPERSEDED shows the update message with a reload button", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "x", code: "SUPERSEDED" }), { status: 409 }),
    );
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Maria");
    await userEvent.type(screen.getByLabelText("E-mail"), "maria@bella.test");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Esta proposta foi atualizada. Recarregue para ver a versão atual.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("ALREADY_RESPONDED refreshes to show the recorded response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "x", code: "ALREADY_RESPONDED" }), { status: 409 }),
    );
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Recusar" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Maria");
    await userEvent.type(screen.getByLabelText("E-mail"), "maria@bella.test");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("429 asks to wait and keeps what was typed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "x" }), { status: 429, headers: { "Retry-After": "300" } }),
    );
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Maria");
    await userEvent.type(screen.getByLabelText("E-mail"), "maria@bella.test");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recarregar" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toHaveValue("Maria");
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });

  it("with a response shows the result and no buttons", () => {
    renderView({ response: { action: "ACCEPT", respondentName: "Maria", respondedAtLabel: "26 de setembro de 2026", message: null } });
    expect(screen.queryByRole("button", { name: "Aceitar" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Proposta aceita por Maria em 26 de setembro de 2026.");
  });

  async function acceptWith(name: string, email: string) {
    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    await userEvent.type(screen.getByLabelText("Nome"), name);
    await userEvent.type(screen.getByLabelText("E-mail"), email);
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
  }

  it("400 with a field error shows it under the field, marks it invalid, and hides the general message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: { email: ["E-mail inválido."] } }), { status: 400 }),
    );
    renderView();
    await acceptWith("Maria", "maria@bella");

    expect(await screen.findByText("E-mail inválido.")).toBeInTheDocument();
    const email = screen.getByLabelText("E-mail");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("E-mail inválido.");
    expect(screen.getByLabelText("Nome")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Confira os dados informados.")).not.toBeInTheDocument();
  });

  it("editing a field clears only that field's server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: { name: ["Informe seu nome."], email: ["E-mail inválido."] } }), { status: 400 }),
    );
    renderView();
    await acceptWith("M", "maria@bella");
    await screen.findByText("E-mail inválido.");

    await userEvent.type(screen.getByLabelText("E-mail"), ".test");
    expect(screen.queryByText("E-mail inválido.")).not.toBeInTheDocument();
    expect(screen.getByText("Informe seu nome.")).toBeInTheDocument();
  });

  it("400 without visible-field errors keeps the general message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: { publicationId: ["Invalid UUID"] } }), { status: 400 }),
    );
    renderView();
    await acceptWith("Maria", "maria@bella.test");
    expect(await screen.findByText("Confira os dados informados.")).toBeInTheDocument();
  });

  it("a new submit clears previous server errors", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: { email: ["E-mail inválido."] } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "x" }), { status: 500 }));
    renderView();
    await acceptWith("Maria", "maria@bella");
    await screen.findByText("E-mail inválido.");

    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Não foi possível registrar sua resposta. Tente novamente.")).toBeInTheDocument();
    expect(screen.queryByText("E-mail inválido.")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
