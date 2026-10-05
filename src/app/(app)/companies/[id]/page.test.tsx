// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const replace = vi.fn();
const push = vi.fn();
const toastSuccess = vi.fn();
let state: { data?: unknown; isLoading: boolean; error: unknown } = { isLoading: false, error: null };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }) }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock("@/components/shell/session-role-context", () => ({ useIsCreator: () => false }));
vi.mock("@/hooks/use-crm", () => ({ useCompany: () => ({ ...state, refetch: vi.fn() }) }));
vi.mock("@/components/crm/company-form-dialog", () => ({
  CompanyFormDialog: ({ open, onSaved }: { open: boolean; onSaved: (c: unknown) => void }) =>
    open ? (
      <button type="button" onClick={() => onSaved({ id: "c1", name: "Nova" })}>
        fake-save-company
      </button>
    ) : null,
}));
vi.mock("@/components/crm/merge-company-dialog", () => ({
  MergeCompanyDialog: ({ open, onMerged }: { open: boolean; onMerged: (c: unknown) => void }) =>
    open ? (
      <button type="button" onClick={() => onMerged({ id: "c2", name: "Outra" })}>
        fake-merge-company
      </button>
    ) : null,
}));
vi.mock("@/components/crm/company-aliases", () => ({
  CompanyAliases: ({ aliases }: { aliases: unknown[] }) => <div>aliases-{aliases.length}</div>,
}));
vi.mock("@/components/crm/brand-form-dialog", () => ({ BrandFormDialog: () => null }));
vi.mock("@/components/crm/crm-opportunities-table", () => ({
  CrmOpportunitiesTable: ({ opportunities }: { opportunities: unknown[] }) => <div>opps-{opportunities.length}</div>,
}));

import CompanyPage from "./page";

const detail = {
  company: { id: "c1", name: "Bella Cosméticos", createdAt: "2026-10-01T00:00:00.000Z" },
  aliases: [{ id: "a1", name: "Bella" }],
  brands: [{ id: "b1", name: "Linha Verão" }],
  contacts: [{ id: "p1", fullName: "Maria", email: "m@x.com", phone: null, instagramHandle: null }],
  opportunities: [{ id: "o1" }],
};

async function renderPage() {
  await act(async () => {
    render(
      <React.Suspense fallback={null}>
        <CompanyPage params={Promise.resolve({ id: "c1" })} />
      </React.Suspense>,
    );
  });
}

describe("CompanyPage", () => {
  beforeEach(() => {
    state = { data: detail, isLoading: false, error: null };
    toastSuccess.mockReset();
    push.mockReset();
  });

  it("shows the company with brands, contacts (linked) and opportunities", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Bella Cosméticos" })).toBeTruthy();
    expect(screen.getByText("Linha Verão")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Maria" }).getAttribute("href")).toBe("/contacts/p1");
    expect(screen.getByText("opps-1")).toBeTruthy();
  });

  it("edits the company and toasts", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Editar empresa" }));
    await userEvent.click(screen.getByRole("button", { name: "fake-save-company" }));
    expect(toastSuccess).toHaveBeenCalledWith("Empresa atualizada.");
  });

  it("shows the aliases block", async () => {
    await renderPage();
    expect(screen.getByText("aliases-1")).toBeTruthy();
  });

  it("merges into another company, toasts and navigates to the one that stays", async () => {
    await renderPage();
    expect(screen.queryByRole("button", { name: "fake-merge-company" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Mesclar em…" }));
    await userEvent.click(screen.getByRole("button", { name: "fake-merge-company" }));
    expect(toastSuccess).toHaveBeenCalledWith("Empresas mescladas.");
    expect(push).toHaveBeenCalledWith("/companies/c2");
  });

  it("shows not found for a 404", async () => {
    state = { data: undefined, isLoading: false, error: new ApiError(404, "Empresa não encontrada.") };
    await renderPage();
    expect(screen.getByText("Empresa não encontrada.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voltar para Empresas" }).getAttribute("href")).toBe("/companies");
  });
});
