// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const mutateAsync = vi.fn();
const refetch = vi.fn();
let preview: { data?: unknown; isLoading: boolean; isError: boolean; error: unknown } = { isLoading: false, isError: false, error: null };
vi.mock("@/hooks/use-crm", () => ({
  useContacts: () => ({
    data: [
      { id: "p1", fullName: "Maria", companyName: null },
      { id: "p2", fullName: "Maria Souza", companyName: "Bella" },
      { id: "p3", fullName: "Joana", companyName: null },
    ],
  }),
}));
vi.mock("@/hooks/use-crm-merge", () => ({
  useContactMergePreview: (_id: string, into: string | null) =>
    into === null ? { isLoading: false, isError: false, error: null, refetch } : { ...preview, refetch },
  useMergeContact: () => ({ mutateAsync, isPending: false }),
}));

import { MergeContactDialog } from "./merge-contact-dialog";

const basePreview = {
  duplicate: { id: "p1", name: "Maria" },
  stays: { id: "p2", name: "Maria Souza" },
  result: { fullName: "Maria Souza", email: "m@x.com", phone: "1199", instagramHandle: null, company: { id: "c1", name: "Bella" } },
  filledFromDuplicate: ["email", "companyId"],
  impact: { leads: 3 },
};

const row = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;

async function renderAndPick(onMerged = vi.fn()) {
  render(<MergeContactDialog open contact={{ id: "p1", fullName: "Maria" }} onOpenChange={() => {}} onMerged={onMerged} />);
  await userEvent.click(screen.getByRole("combobox", { name: "Contato que fica" }));
  await userEvent.click(await screen.findByText("Maria Souza (Bella)"));
  return onMerged;
}

describe("MergeContactDialog", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    refetch.mockReset();
    preview = { data: basePreview, isLoading: false, isError: false, error: null };
  });

  it("lists other contacts as 'name (company)' or just the name, and disables Mesclar until chosen", async () => {
    render(<MergeContactDialog open contact={{ id: "p1", fullName: "Maria" }} onOpenChange={() => {}} onMerged={() => {}} />);
    expect((screen.getByRole("button", { name: "Mesclar" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("combobox", { name: "Contato que fica" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Maria Souza (Bella)", "Joana"]);
  });

  it("shows the final fields marking the ones filled from the duplicate, then merges", async () => {
    const onMerged = await renderAndPick();
    expect(row("Nome").textContent).toBe("Maria Souza");
    expect(row("E-mail").textContent).toBe("m@x.com (do duplicado)");
    expect(row("Telefone").textContent).toBe("1199");
    expect(row("Instagram").textContent).toBe("—");
    expect(row("Empresa").textContent).toBe("Bella (do duplicado)");
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Vai mover: 3 leads")).toBeTruthy();
    const warning = screen.getByRole("note");
    expect(warning.textContent).toBe("Esta ação não pode ser desfeita. Maria será excluído.");
    expect(warning.querySelector("svg")).toBeTruthy();
    expect(within(warning).getByText("Maria").tagName).toBe("STRONG");

    mutateAsync.mockResolvedValue({ id: "p2" });
    await userEvent.click(screen.getByRole("button", { name: "Mesclar" }));
    expect(mutateAsync).toHaveBeenCalledWith({ into: "p2" });
    expect(onMerged).toHaveBeenCalledWith({ id: "p2" });
  });

  it("uses the singular for one lead", async () => {
    preview = { ...preview, data: { ...basePreview, impact: { leads: 1 } } };
    await renderAndPick();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Vai mover: 1 lead")).toBeTruthy();
  });

  it("shows a 422 under the combobox", async () => {
    await renderAndPick();
    mutateAsync.mockRejectedValueOnce(new ApiError(422, "Escolha outro contato.", { code: "SAME_RECORD" }));
    await userEvent.click(screen.getByRole("button", { name: "Mesclar" }));
    expect(await screen.findByText("Escolha outro contato.")).toBeTruthy();
  });

  it("offers to retry when the preview fails", async () => {
    preview = { data: undefined, isLoading: false, isError: true, error: new ApiError(500, "x") };
    await renderAndPick();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.getByText("Não foi possível carregar a prévia")).toBeTruthy();
  });

  it("renders no emoji or symbol glyphs", async () => {
    await renderAndPick();
    expect(document.body.textContent).not.toMatch(/[\p{Extended_Pictographic}←-⇿▲▼✓✔]/u);
  });
});
