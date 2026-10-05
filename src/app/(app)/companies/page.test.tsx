// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const replace = vi.fn();
let isCreator = false;
let companies: unknown[] | undefined = [];
let brands: unknown[] | undefined = [];
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("@/components/shell/session-role-context", () => ({ useIsCreator: () => isCreator }));
vi.mock("@/hooks/use-crm", () => ({
  useCompanies: () => ({ data: companies, isLoading: false, isError: false, refetch: vi.fn() }),
  useBrands: () => ({ data: brands }),
}));
vi.mock("@/components/crm/brand-form-dialog", () => ({
  BrandFormDialog: ({ open, brand }: { open: boolean; brand: { name: string } }) => (open ? <div>dialog-{brand.name}</div> : null),
}));

import CompaniesPage from "./page";

const bella = { id: "c1", name: "Bella Cosméticos", createdAt: "2026-10-01T12:00:00.000Z", brandCount: 2, contactCount: 1, openOpportunityCount: 3 };
const acme = { id: "c2", name: "Acme", createdAt: "2026-10-02T12:00:00.000Z", brandCount: 0, contactCount: 0, openOpportunityCount: 0 };

describe("CompaniesPage", () => {
  beforeEach(() => {
    isCreator = false;
    companies = [bella, acme];
    brands = [];
    push.mockReset();
    replace.mockReset();
  });

  it("lists companies with counts and filters by accent-insensitive search", async () => {
    render(<CompaniesPage />);
    expect(screen.getByText("Bella Cosméticos")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar empresa" }), "cosmeticos");
    expect(screen.queryByText("Acme")).toBeNull();
    expect(screen.getByText("Bella Cosméticos")).toBeTruthy();
  });

  it("navigates to the detail on row click", async () => {
    render(<CompaniesPage />);
    expect(screen.getByRole("link", { name: "Bella Cosméticos" })).toHaveAttribute("href", "/companies/c1");
    await userEvent.click(screen.getByText("3"));
    expect(push).toHaveBeenCalledWith("/companies/c1");
  });

  it("shows the empty state pointing to the inbox", () => {
    companies = [];
    render(<CompaniesPage />);
    expect(screen.getByText("Nenhuma empresa ainda")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ir para o Inbox" }).getAttribute("href")).toBe("/inbox");
  });

  it("hides the brands-without-company block when there are none", () => {
    render(<CompaniesPage />);
    expect(screen.queryByText("Brands sem empresa")).toBeNull();
  });

  it("shows brands without company and opens the brand dialog", async () => {
    brands = [{ id: "b1", name: "Sem Dono", companyId: null }, { id: "b2", name: "Linha", companyId: "c1" }];
    render(<CompaniesPage />);
    expect(screen.getByText("Brands sem empresa")).toBeTruthy();
    expect(screen.queryByText("Linha")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Vincular Sem Dono" }));
    expect(screen.getByText("dialog-Sem Dono")).toBeTruthy();
  });

  it("redirects a creator to the pipeline", () => {
    isCreator = true;
    render(<CompaniesPage />);
    expect(replace).toHaveBeenCalledWith("/pipeline");
  });
});
