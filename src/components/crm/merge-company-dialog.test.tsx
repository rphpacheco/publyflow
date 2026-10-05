// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const mutateAsync = vi.fn();
const refetch = vi.fn();
let preview: { data?: unknown; isLoading: boolean; isError: boolean; error: unknown } = { isLoading: false, isError: false, error: null };
const previewInto = vi.fn();
vi.mock("@/hooks/use-crm", () => ({
  useCompanies: () => ({
    data: [
      { id: "c1", name: "Bella" },
      { id: "c2", name: "Bella Cosméticos" },
    ],
  }),
}));
vi.mock("@/hooks/use-crm-merge", () => ({
  useCompanyMergePreview: (_id: string, into: string | null) => {
    previewInto(into);
    return into === null ? { isLoading: false, isError: false, error: null, refetch } : { ...preview, refetch };
  },
  useMergeCompany: () => ({ mutateAsync, isPending: false }),
}));

import { MergeCompanyDialog } from "./merge-company-dialog";

const basePreview = {
  duplicate: { id: "c1", name: "Bella" },
  stays: { id: "c2", name: "Bella Cosméticos" },
  result: { name: "Bella Cosméticos" },
  impact: { brands: 2, contacts: 3, leads: 1, opportunities: 4 },
  aliasToAdd: "Bella",
  aliasesMoved: 0,
};

const text = (value: string) => screen.getByText((_, el) => el?.tagName === "P" && el.textContent === value);

async function renderAndPick(onMerged = vi.fn()) {
  render(<MergeCompanyDialog open company={{ id: "c1", name: "Bella" }} onOpenChange={() => {}} onMerged={onMerged} />);
  await userEvent.click(screen.getByRole("combobox", { name: "Empresa que fica" }));
  await userEvent.click(await screen.findByText("Bella Cosméticos"));
  return onMerged;
}

describe("MergeCompanyDialog", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    refetch.mockReset();
    previewInto.mockReset();
    preview = { data: basePreview, isLoading: false, isError: false, error: null };
  });

  it("excludes the current company from the options and disables Mesclar until one is chosen", async () => {
    render(<MergeCompanyDialog open company={{ id: "c1", name: "Bella" }} onOpenChange={() => {}} onMerged={() => {}} />);
    expect((screen.getByRole("button", { name: "Mesclar" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("combobox", { name: "Empresa que fica" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Bella Cosméticos"]);
    expect(previewInto).toHaveBeenLastCalledWith(null);
  });

  it("shows the preview, the irreversible warning with an icon, and merges", async () => {
    const onMerged = await renderAndPick();
    expect(text("Fica: Bella Cosméticos")).toBeTruthy();
    expect(text("Vai mover: 2 brands · 3 contatos · 4 oportunidades")).toBeTruthy();
    expect(text("'Bella' passa a ser apelido de 'Bella Cosméticos'")).toBeTruthy();
    expect(screen.queryByText(/também será movido|também serão movidos/)).toBeNull();
    const warning = screen.getByRole("note");
    expect(warning.textContent).toBe("Esta ação não pode ser desfeita. Bella será excluída.");
    expect(warning.querySelector("svg")).toBeTruthy();
    expect(within(warning).getByText("Bella").tagName).toBe("STRONG");

    mutateAsync.mockResolvedValue({ id: "c2", name: "Bella Cosméticos" });
    await userEvent.click(screen.getByRole("button", { name: "Mesclar" }));
    expect(mutateAsync).toHaveBeenCalledWith({ into: "c2" });
    expect(onMerged).toHaveBeenCalledWith({ id: "c2", name: "Bella Cosméticos" });
  });

  it("pluralizes singular counts and the moved aliases", async () => {
    preview = { ...preview, data: { ...basePreview, impact: { brands: 1, contacts: 1, leads: 0, opportunities: 1 }, aliasesMoved: 1 } };
    await renderAndPick();
    expect(text("Vai mover: 1 brand · 1 contato · 1 oportunidade")).toBeTruthy();
    expect(text("1 apelido também será movido")).toBeTruthy();
  });

  it("uses the plural for several moved aliases", async () => {
    preview = { ...preview, data: { ...basePreview, aliasesMoved: 2 } };
    await renderAndPick();
    expect(text("2 apelidos também serão movidos")).toBeTruthy();
  });

  it("omits the alias line when no alias will be added", async () => {
    preview = { ...preview, data: { ...basePreview, aliasToAdd: null } };
    await renderAndPick();
    expect(screen.queryByText(/passa a ser apelido/)).toBeNull();
  });

  it("shows a 422 under the combobox", async () => {
    await renderAndPick();
    mutateAsync.mockRejectedValueOnce(new ApiError(422, "Escolha outra empresa.", { error: "Escolha outra empresa.", code: "SAME_RECORD" }));
    await userEvent.click(screen.getByRole("button", { name: "Mesclar" }));
    expect(await screen.findByText("Escolha outra empresa.")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Empresa que fica" }).getAttribute("aria-invalid")).toBe("true");
  });

  it("shows other errors at the top", async () => {
    await renderAndPick();
    mutateAsync.mockRejectedValueOnce(new ApiError(404, "Empresa não encontrada.", { error: "Empresa não encontrada." }));
    await userEvent.click(screen.getByRole("button", { name: "Mesclar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Empresa não encontrada.");
  });

  it("offers to retry when the preview fails", async () => {
    preview = { data: undefined, isLoading: false, isError: true, error: new ApiError(500, "x") };
    await renderAndPick();
    expect(screen.getByText("Não foi possível carregar a prévia")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Mesclar" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders no emoji or symbol glyphs", async () => {
    await renderAndPick();
    expect(document.body.textContent).not.toMatch(/[\p{Extended_Pictographic}←-⇿▲▼✓✔]/u);
  });
});
