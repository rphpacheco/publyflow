// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let list: unknown[] | undefined;
const refreshMock = vi.fn();
const replaceMock = vi.fn();
const selectCreator = vi.fn();
let selectedCreatorId: string | null = null;
const toastSuccess = vi.fn();
let isError = false;
const refetchMock = vi.fn();
let isCreator = false;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock, replace: replaceMock }) }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock("@/components/shell/creator-context", () => ({
  useCreatorContext: () => ({ creators: [], selectedCreatorId, selectCreator }),
}));
vi.mock("@/components/shell/session-role-context", () => ({
  useIsCreator: () => isCreator,
}));
vi.mock("@/hooks/use-creators", () => ({
  useCreators: () => ({ data: list, isLoading: false, isError, refetch: refetchMock }),
}));
let savedCreator: unknown;
vi.mock("@/components/creators/creator-form-dialog", () => ({
  CreatorFormDialog: ({ open, creator, onSaved }: { open: boolean; creator: unknown; onSaved: (c: unknown, m: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onSaved(savedCreator, creator ? "edit" : "create")}>
        fake-save
      </button>
    ) : null,
}));
vi.mock("@/components/creators/creator-access-actions", () => ({
  CreatorAccessActions: ({
    creator,
    onInstructions,
  }: {
    creator: { id: string };
    onInstructions: (args: { email: string; message: string }) => void;
  }) => (
    <button type="button" onClick={() => onInstructions({ email: "thais@x.com", message: "msg-" + creator.id })}>
      fake-access-actions
    </button>
  ),
}));
vi.mock("@/components/creators/access-instructions-dialog", () => ({
  AccessInstructionsDialog: ({ open, email, message }: { open: boolean; email: string; message: string }) =>
    open ? <div data-testid="instructions-dialog">{email}: {message}</div> : null,
}));

import CreatorsPage from "./page";

const thais = {
  id: "c1",
  displayName: "Thais",
  instagramHandle: "@thais",
  email: "thais@x.com",
  createdAt: "2026-09-28T12:00:00.000Z",
  access: "invited" as const,
  lastLoginAt: null as string | null,
  emailEditable: true,
};

describe("CreatorsPage", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    replaceMock.mockReset();
    selectCreator.mockReset();
    toastSuccess.mockReset();
    refetchMock.mockReset();
    selectedCreatorId = null;
    isError = false;
    isCreator = false;
  });

  it("empty state offers Novo creator", () => {
    list = [];
    render(<CreatorsPage />);
    expect(screen.getByText("Nenhum creator cadastrado")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Novo creator" }).length).toBeGreaterThan(0);
  });

  it("lists creators with their columns", () => {
    list = [thais];
    render(<CreatorsPage />);
    for (const header of ["Nome de exibição", "@Instagram", "E-mail", "Cadastrado em", "Acesso", "Último acesso"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    expect(screen.getByRole("cell", { name: "Thais" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "thais@x.com" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "fake-access-actions" })).toBeInTheDocument();
  });

  it("maps access statuses to their badge labels", () => {
    list = [
      { ...thais, id: "c1", access: "none" as const },
      { ...thais, id: "c2", access: "invited" as const },
      { ...thais, id: "c3", access: "active" as const },
      { ...thais, id: "c4", access: "team" as const },
    ];
    render(<CreatorsPage />);
    expect(screen.getByText("Sem acesso")).toBeInTheDocument();
    expect(screen.getByText("Convite enviado")).toBeInTheDocument();
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText("Equipe")).toBeInTheDocument();
  });

  it("shows the pt-BR short date for lastLoginAt, or an em dash", () => {
    list = [
      { ...thais, id: "c1", lastLoginAt: "2026-09-28T12:00:00.000Z" },
      { ...thais, id: "c2", lastLoginAt: null },
    ];
    render(<CreatorsPage />);
    expect(
      screen.getAllByText(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date("2026-09-28T12:00:00.000Z"))).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("opens the instructions dialog when access actions report an invite/remind", async () => {
    list = [thais];
    render(<CreatorsPage />);
    await userEvent.click(screen.getByRole("button", { name: "fake-access-actions" }));
    expect(screen.getByTestId("instructions-dialog")).toHaveTextContent("thais@x.com: msg-c1");
  });

  it("after creating: toast, refresh, and selects the new creator when none was selected", async () => {
    list = [];
    savedCreator = { ...thais, id: "c9" };
    render(<CreatorsPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Novo creator" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "fake-save" }));
    expect(toastSuccess).toHaveBeenCalledWith("Creator cadastrado.");
    expect(refreshMock).toHaveBeenCalled();
    expect(selectCreator).toHaveBeenCalledWith("c9");
  });

  it("after editing: toast and refresh, no re-selection", async () => {
    list = [thais];
    selectedCreatorId = "c1";
    savedCreator = thais;
    render(<CreatorsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    await userEvent.click(screen.getByRole("button", { name: "fake-save" }));
    expect(toastSuccess).toHaveBeenCalledWith("Creator atualizado.");
    expect(refreshMock).toHaveBeenCalled();
    expect(selectCreator).not.toHaveBeenCalled();
  });

  it("shows an error message instead of the empty state when loading fails, and retries on click", async () => {
    list = undefined;
    isError = true;
    render(<CreatorsPage />);
    expect(screen.getByText("Não foi possível carregar os creators.")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum creator cadastrado")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo creator" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetchMock).toHaveBeenCalled();
  });

  it("under CREATOR, redirects to /pipeline and renders nothing", () => {
    isCreator = true;
    list = [thais];
    const { container } = render(<CreatorsPage />);
    expect(replaceMock).toHaveBeenCalledWith("/pipeline");
    expect(container).toBeEmptyDOMElement();
  });
});
