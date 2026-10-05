// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const replace = vi.fn();
const push = vi.fn();
const toastSuccess = vi.fn();
let isCreator = false;
let state: { data?: unknown; isLoading: boolean; error: unknown } = { isLoading: false, error: null };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }) }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock("@/components/shell/session-role-context", () => ({ useIsCreator: () => isCreator }));
vi.mock("@/hooks/use-crm", () => ({ useContact: () => ({ ...state, refetch: vi.fn() }) }));
vi.mock("@/components/crm/contact-form-dialog", () => ({
  ContactFormDialog: ({ open, onSaved }: { open: boolean; onSaved: (c: unknown) => void }) =>
    open ? (
      <button type="button" onClick={() => onSaved({ id: "p1", fullName: "Nova" })}>
        fake-save-contact
      </button>
    ) : null,
}));
vi.mock("@/components/crm/merge-contact-dialog", () => ({
  MergeContactDialog: ({ open, onMerged }: { open: boolean; onMerged: (c: unknown) => void }) =>
    open ? (
      <button type="button" onClick={() => onMerged({ id: "p2", fullName: "Outra" })}>
        fake-merge-contact
      </button>
    ) : null,
}));
vi.mock("@/components/crm/crm-opportunities-table", () => ({
  CrmOpportunitiesTable: ({ opportunities }: { opportunities: unknown[] }) => <div>opps-{opportunities.length}</div>,
}));

import ContactPage from "./page";

const detail = {
  contact: { id: "p1", fullName: "Maria", email: "m@x.com", phone: null, instagramHandle: null, companyId: "c1", createdAt: "2026-10-01T00:00:00.000Z" },
  company: { id: "c1", name: "Bella" },
  opportunities: [{ id: "o1" }],
};

async function renderPage() {
  await act(async () => {
    render(
      <React.Suspense fallback={null}>
        <ContactPage params={Promise.resolve({ id: "p1" })} />
      </React.Suspense>,
    );
  });
}

describe("ContactPage", () => {
  beforeEach(() => {
    isCreator = false;
    state = { data: detail, isLoading: false, error: null };
    toastSuccess.mockReset();
    replace.mockReset();
    push.mockReset();
  });

  it("shows the contact with company link and opportunities", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Maria" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Bella" }).getAttribute("href")).toBe("/companies/c1");
    expect(screen.getByText("m@x.com")).toBeTruthy();
    expect(screen.getByText("opps-1")).toBeTruthy();
  });

  it("shows 'Sem empresa' when the contact has no company", async () => {
    state = { data: { ...detail, company: null }, isLoading: false, error: null };
    await renderPage();
    expect(screen.getByText("Sem empresa")).toBeTruthy();
  });

  it("edits the contact and toasts", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Editar contato" }));
    await userEvent.click(screen.getByRole("button", { name: "fake-save-contact" }));
    expect(toastSuccess).toHaveBeenCalledWith("Contato atualizado.");
  });

  it("merges into another contact, toasts and navigates to the one that stays", async () => {
    await renderPage();
    expect(screen.queryByRole("button", { name: "fake-merge-contact" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Mesclar em…" }));
    await userEvent.click(screen.getByRole("button", { name: "fake-merge-contact" }));
    expect(toastSuccess).toHaveBeenCalledWith("Contatos mesclados.");
    expect(push).toHaveBeenCalledWith("/contacts/p2");
  });

  it("shows not found for a 404", async () => {
    state = { data: undefined, isLoading: false, error: new ApiError(404, "Contato não encontrado.") };
    await renderPage();
    expect(screen.getByText("Contato não encontrado.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voltar para Contatos" }).getAttribute("href")).toBe("/contacts");
  });

  it("shows a generic error with retry", async () => {
    state = { data: undefined, isLoading: false, error: new Error("boom") };
    await renderPage();
    expect(screen.getByText("Não foi possível carregar o contato.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
  });

  it("shows loading", async () => {
    state = { data: undefined, isLoading: true, error: null };
    await renderPage();
    expect(screen.getByText("Carregando...")).toBeTruthy();
  });

  it("redirects a creator to the pipeline", async () => {
    isCreator = true;
    await renderPage();
    expect(replace).toHaveBeenCalledWith("/pipeline");
  });
});
