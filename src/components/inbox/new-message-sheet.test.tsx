// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { NewMessageSheet } from "./new-message-sheet";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NewMessageSheet", () => {
  it("submits the form and calls onSent on success", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSent = vi.fn();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <NewMessageSheet
          open
          onOpenChange={() => {}}
          organizationId="org1"
          creatorId="creator1"
          onSent={onSent}
        />
        <Toaster />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText("Remetente"), "Maria — Bella Cosméticos");
    await user.type(screen.getByLabelText("Mensagem"), "Olá, gostaríamos de saber os valores.");

    const channelSelect = screen.getByRole("combobox", { name: "Canal" });
    await user.click(channelSelect);
    await user.click(await screen.findByRole("option", { name: "WhatsApp" }));

    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await vi.waitFor(() => expect(onSent).toHaveBeenCalled());

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      organizationId: "org1",
      creatorId: "creator1",
      source: "WHATSAPP",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores.",
    });
  });
});
