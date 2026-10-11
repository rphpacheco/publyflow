// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let list: unknown[] | undefined;
let isError = false;
let role: "OWNER" | "MANAGER" | "CREATOR" = "OWNER";
const replaceMock = vi.fn();
const refetchMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: replaceMock }) }));
vi.mock("@/components/shell/session-role-context", () => ({ useSessionRole: () => role }));
vi.mock("@/hooks/use-team", () => ({
  useTeam: () => ({ data: list, isLoading: false, isError, refetch: refetchMock }),
}));
vi.mock("@/components/team/invite-manager-dialog", () => ({
  InviteManagerDialog: ({ open, onInvited }: { open: boolean; onInvited: (a: { email: string; message: string }) => void }) =>
    open ? (
      <button type="button" onClick={() => onInvited({ email: "n@x.com", message: "msg-novo" })}>
        fake-invite
      </button>
    ) : null,
}));
vi.mock("@/components/team/team-member-actions", () => ({
  TeamMemberActions: ({
    member,
    onInstructions,
  }: {
    member: { fullName: string };
    onInstructions: (a: { email: string; message: string }) => void;
  }) => (
    <button type="button" onClick={() => onInstructions({ email: "r@x.com", message: "msg-reenvio" })}>
      Ações de {member.fullName}
    </button>
  ),
}));
vi.mock("@/components/creators/access-instructions-dialog", () => ({
  AccessInstructionsDialog: ({ open, email, message }: { open: boolean; email: string; message: string }) =>
    open ? (
      <div>
        <h2>Instruções de acesso</h2>
        {email}: {message}
      </div>
    ) : null,
}));

import TeamPage from "./page";

const team = [
  { id: "u1", fullName: "Olga Dona", email: "olga@x.com", role: "OWNER", status: "active", isSelf: true },
  { id: "u2", fullName: "Bia Gestora", email: "bia@x.com", role: "MANAGER", status: "invited", isSelf: false },
];

describe("TeamPage", () => {
  beforeEach(() => {
    list = team;
    isError = false;
    role = "OWNER";
    replaceMock.mockReset();
    refetchMock.mockReset();
  });

  it("OWNER sees the invite button, actions only on MANAGER rows, labels and Você", () => {
    render(<TeamPage />);
    expect(screen.getByRole("heading", { name: "Equipe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Convidar gestor" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Ações de Bia Gestora" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Ações de Olga Dona" })).toBeNull();
    expect(screen.getAllByText("Você").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Proprietário").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gestor").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ativo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Convidado").length).toBeGreaterThan(0);
  });

  it("MANAGER sees the list without button or menu", () => {
    role = "MANAGER";
    render(<TeamPage />);
    expect(screen.getAllByText("Bia Gestora").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Convidar gestor" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Ações de/ })).toBeNull();
  });

  it("CREATOR is redirected and sees nothing", () => {
    role = "CREATOR";
    const { container } = render(<TeamPage />);
    expect(replaceMock).toHaveBeenCalledWith("/pipeline");
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an error state with retry", async () => {
    isError = true;
    list = undefined;
    render(<TeamPage />);
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetchMock).toHaveBeenCalled();
  });

  it("opens the instructions dialog after an invite", async () => {
    render(<TeamPage />);
    await userEvent.click(screen.getByRole("button", { name: "Convidar gestor" }));
    await userEvent.click(screen.getByRole("button", { name: "fake-invite" }));
    expect(await screen.findByRole("heading", { name: "Instruções de acesso" })).toBeInTheDocument();
    expect(screen.getByText(/msg-novo/)).toBeInTheDocument();
  });

  it("opens the instructions dialog after resend", async () => {
    render(<TeamPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Ações de Bia Gestora" })[0]);
    expect(await screen.findByText(/msg-reenvio/)).toBeInTheDocument();
  });

  it("renders no emoji or symbol glyphs", () => {
    const { container } = render(<TeamPage />);
    expect(container.textContent ?? "").not.toMatch(/[•✓✔▲▼★☀-➿\u{1F300}-\u{1FAFF}]/u);
  });
});
