// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import { InquirySidePanel } from "./inquiry-side-panel";

afterEach(() => {
  vi.unstubAllGlobals();
  toast.dismiss();
});

const inquiry: CommercialInquiryListItem = {
  id: "i1",
  organizationId: "org1",
  creatorId: "creator1",
  messageId: "m1",
  status: "NEW",
  companyGuess: "Bella Cosméticos",
  brandGuess: null,
  contactNameGuess: "Maria",
  budgetGuess: null,
  intentGuess: "Pedido de mídia kit",
  convertedLeadId: null,
  linkedOpportunityId: null,
  createdAt: "2026-01-01T12:00:00.000Z",
  messageBody: "Olá, gostaríamos de saber os valores.",
  messageReceivedAt: "2026-01-01T12:00:00.000Z",
  externalContactLabel: "Maria — Bella Cosméticos",
  source: "INSTAGRAM",
  conversationId: "conv1",
};

function paragraphWithText(text: string) {
  return screen.getByText(
    (_content, element) => element !== null && element.tagName === "P" && element.textContent === text,
  );
}

function renderPanel(
  options: {
    onOpenChange?: (open: boolean) => void;
    inquiryOverrides?: Partial<CommercialInquiryListItem>;
    readOnly?: boolean;
  } = {},
) {
  const onOpenChange = options.onOpenChange ?? vi.fn();
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <InquirySidePanel
        inquiry={{ ...inquiry, ...options.inquiryOverrides }}
        open
        onOpenChange={onOpenChange}
        creatorId="creator1"
        status="NEW"
        readOnly={options.readOnly}
      />
      <Toaster />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe("InquirySidePanel", () => {
  it("shows the full message and discards the inquiry on click, then closes", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    const { onOpenChange } = renderPanel();

    expect(screen.getByText("Olá, gostaríamos de saber os valores.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Descartar" }));

    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(await screen.findByText(/Descartada/)).toBeInTheDocument();
  });

  it("shows a clear message (not a generic error) when convert fails with 422 AMBIGUOUS_PARTY", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({
          error: "Mais de uma empresa ou marca com esse nome — selecione a correta.",
          code: "AMBIGUOUS_PARTY",
        }),
      }),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Converter em Opportunity" }));

    expect(
      await screen.findByText("Mais de uma empresa ou marca com esse nome — selecione a correta."),
    ).toBeInTheDocument();
  });

  it("falls back to the edit form automatically when convert returns AMBIGUOUS_PARTY, and confirming it retries with the resolved company and brand", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/convert") && init) {
        const body = JSON.parse(init.body as string);
        if (body.companyId === "c1") {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ inquiry: {}, lead: {}, opportunity: {} }) });
        }
        return Promise.resolve({
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
          json: async () => ({
            error: "Mais de uma empresa ou marca com esse nome — selecione a correta.",
            code: "AMBIGUOUS_PARTY",
          }),
        });
      }
      if (url.includes("/api/companies")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: "c1", organizationId: "org1", name: "Bella Cosméticos Ltda", createdAt: "2026-01-01" }],
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();

    await user.click(screen.getByRole("button", { name: "Converter em Opportunity" }));
    expect(
      await screen.findByText("Mais de uma empresa ou marca com esse nome — selecione a correta."),
    ).toBeInTheDocument();

    const companyCombobox = await screen.findByRole("combobox", { name: /empresa/i });
    await user.click(companyCombobox);
    await user.click(await screen.findByText("Bella Cosméticos Ltda"));
    await user.click(screen.getByRole("button", { name: "Sem marca" }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Convertida em Opportunity")).toBeInTheDocument();
  });

  it("keeps edit mode open with an actionable message when the retried convert also fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/convert") && init) {
        return Promise.resolve({
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
          json: async () => ({
            error: "Mais de uma empresa ou marca com esse nome — selecione a correta.",
            code: "AMBIGUOUS_PARTY",
          }),
        });
      }
      if (url.includes("/api/companies")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: "c1", organizationId: "org1", name: "Bella Cosméticos Ltda", createdAt: "2026-01-01" }],
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();

    await user.click(screen.getByRole("button", { name: "Converter em Opportunity" }));
    expect(
      await screen.findByText("Mais de uma empresa ou marca com esse nome — selecione a correta."),
    ).toBeInTheDocument();

    const companyCombobox = await screen.findByRole("combobox", { name: /empresa/i });
    await user.click(companyCombobox);
    await user.click(await screen.findByText("Bella Cosméticos Ltda"));
    await user.click(screen.getByRole("button", { name: "Sem marca" }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText(/Ainda não foi possível resolver — revise a seleção de empresa e marca abaixo\./),
    ).toBeInTheDocument();
    // Edit mode stays open: the combobox is still on screen, not the default action buttons.
    expect(screen.getByRole("combobox", { name: /empresa/i })).toBeInTheDocument();
  });

  it("shows the PARTY_REQUIRED message and opens the Dados edit inputs when convert is rejected for missing company/brand", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({
          error: "Informe a empresa ou a marca antes de converter.",
          code: "PARTY_REQUIRED",
        }),
      }),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Converter em Opportunity" }));

    expect(
      await screen.findByText("Informe a empresa ou a marca antes de converter."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Empresa")).toBeInTheDocument();
    expect(screen.getByLabelText("Contato")).toBeInTheDocument();
    expect(screen.getByLabelText("Marca")).toBeInTheDocument();
  });

  it("shows the raw error message for other convert failures, without opening any edit UI", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: async () => ({ error: "Esta mensagem já foi resolvida." }),
      }),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Converter em Opportunity" }));

    expect(await screen.findByText("Esta mensagem já foi resolvida.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Empresa")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /empresa/i })).not.toBeInTheDocument();
  });

  it("sends the external contact label as the convert contact name when there is no contact guess", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ inquiry: {}, lead: {}, opportunity: {} }) });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel({ inquiryOverrides: { contactNameGuess: null, externalContactLabel: "Rodolfo Barbosa" } });

    await user.click(screen.getByRole("button", { name: "Converter em Opportunity" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/commercial-inquiries/i1/convert");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.contact).toEqual({ fullName: "Rodolfo Barbosa" });
  });

  describe("Dados block", () => {
    it("shows placeholders and an edit button when all guesses are null", () => {
      vi.stubGlobal("fetch", vi.fn());
      renderPanel({
        inquiryOverrides: { contactNameGuess: null, companyGuess: null, brandGuess: null },
      });

      expect(screen.getByRole("heading", { name: "Dados" })).toBeInTheDocument();
      expect(paragraphWithText("Contato: —")).toBeInTheDocument();
      expect(paragraphWithText("Empresa: —")).toBeInTheDocument();
      expect(paragraphWithText("Marca: —")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Editar dados" })).toBeInTheDocument();
    });

    it("edits and saves Dados, updating the block and toasting success", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ ...inquiry, companyGuess: "Barbosa Moda" }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel();

      await user.click(screen.getByRole("button", { name: "Editar dados" }));

      const contactInput = screen.getByLabelText("Contato");
      const companyInput = screen.getByLabelText("Empresa");
      const brandInput = screen.getByLabelText("Marca");
      expect(contactInput).toHaveValue("Maria");
      expect(companyInput).toHaveValue("Bella Cosméticos");
      expect(brandInput).toHaveValue("");

      await user.clear(companyInput);
      await user.type(companyInput, "Barbosa Moda");
      await user.click(screen.getByRole("button", { name: "Salvar" }));

      await vi.waitFor(() => {
        const call = fetchMock.mock.calls.find(([callUrl]) => callUrl === "/api/commercial-inquiries/i1");
        expect(call).toBeDefined();
      });
      const [, patchInit] = fetchMock.mock.calls.find(
        ([callUrl]) => callUrl === "/api/commercial-inquiries/i1",
      )!;
      expect((patchInit as RequestInit).method).toBe("PATCH");
      const body = JSON.parse((patchInit as RequestInit).body as string);
      expect(body).toEqual({ contactName: "Maria", companyName: "Barbosa Moda", brandName: null });

      expect(await screen.findByText("Dados atualizados.")).toBeInTheDocument();
      expect(paragraphWithText("Empresa: Barbosa Moda")).toBeInTheDocument();
    });

    it("Cancelar closes the edit form without calling the update mutation", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      renderPanel();

      await user.click(screen.getByRole("button", { name: "Editar dados" }));
      expect(screen.getByLabelText("Empresa")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(screen.queryByLabelText("Empresa")).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("hides the Dados block and the edit button when readOnly", () => {
      vi.stubGlobal("fetch", vi.fn());
      renderPanel({ readOnly: true });

      expect(screen.queryByRole("heading", { name: "Dados" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Editar dados" })).not.toBeInTheDocument();
    });

    it("hides the Dados block and the edit button for non-NEW inquiries", () => {
      vi.stubGlobal("fetch", vi.fn());
      renderPanel({ inquiryOverrides: { status: "CONVERTED" } });

      expect(screen.queryByRole("heading", { name: "Dados" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Editar dados" })).not.toBeInTheDocument();
    });
  });

  it("hides mutation actions and registers no shortcut actions when readOnly", () => {
    const queryClient = new QueryClient();
    const registerActions = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <InquirySidePanel
          inquiry={inquiry}
          open
          onOpenChange={() => {}}
          creatorId="creator1"
          status="NEW"
          readOnly
          registerActions={registerActions}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole("button", { name: "Converter em Opportunity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Falso Positivo" })).not.toBeInTheDocument();
    expect(registerActions).not.toHaveBeenCalled();
  });
});
