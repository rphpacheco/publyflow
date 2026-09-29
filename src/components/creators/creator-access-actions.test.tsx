// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const inviteMock = vi.fn();
const remindMock = vi.fn();
const revokeMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/hooks/use-creators", () => ({
  useInviteCreator: () => ({ mutateAsync: inviteMock, isPending: false }),
  useRemindCreatorAccess: () => ({ mutateAsync: remindMock, isPending: false }),
  useRevokeCreatorAccess: () => ({ mutateAsync: revokeMock, isPending: false }),
}));

import { CreatorAccessActions } from "./creator-access-actions";

const thais = { id: "c1", displayName: "Thais", email: "thais@x.com", access: "none" as const };

describe("CreatorAccessActions", () => {
  beforeEach(() => {
    inviteMock.mockReset();
    remindMock.mockReset();
    revokeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("none: Convidar opens a confirmation, and confirming invites, toasts, and calls onInstructions", async () => {
    inviteMock.mockResolvedValue({ loginUrl: "http://x/login", message: "msg" });
    const onInstructions = vi.fn();
    render(<CreatorAccessActions creator={thais} onInstructions={onInstructions} />);

    await userEvent.click(screen.getByRole("button", { name: "Convidar" }));
    expect(
      await screen.findByText("Thais poderá entrar no PublyFlow e ver as próprias demandas, oportunidades e propostas."),
    ).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole("button", { name: "Convidar" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(inviteMock).toHaveBeenCalledWith({ creatorId: "c1" });
    expect(toastSuccess).toHaveBeenCalledWith("Convite criado.");
    expect(onInstructions).toHaveBeenCalledWith({ email: "thais@x.com", message: "msg" });
  });

  it("invited: Reenviar instruções remind then onInstructions; Revogar acesso confirms and revokes", async () => {
    remindMock.mockResolvedValue({ loginUrl: "http://x/login", message: "msg2" });
    const onInstructions = vi.fn();
    render(<CreatorAccessActions creator={{ ...thais, access: "invited" }} onInstructions={onInstructions} />);

    await userEvent.click(screen.getByRole("button", { name: "Reenviar instruções" }));
    expect(remindMock).toHaveBeenCalledWith({ creatorId: "c1" });
    expect(onInstructions).toHaveBeenCalledWith({ email: "thais@x.com", message: "msg2" });

    await userEvent.click(screen.getByRole("button", { name: "Revogar acesso" }));
    expect(await screen.findByText("Thais perderá o acesso imediatamente.")).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole("button", { name: "Revogar acesso" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(revokeMock).toHaveBeenCalledWith({ creatorId: "c1" });
    expect(toastSuccess).toHaveBeenCalledWith("Acesso revogado.");
  });

  it("active: same actions as invited", async () => {
    remindMock.mockResolvedValue({ loginUrl: "http://x/login", message: "msg3" });
    render(<CreatorAccessActions creator={{ ...thais, access: "active" }} onInstructions={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Reenviar instruções" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revogar acesso" })).toBeInTheDocument();
  });

  it("team: no access buttons", () => {
    render(<CreatorAccessActions creator={{ ...thais, access: "team" }} onInstructions={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Convidar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reenviar instruções" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revogar acesso" })).not.toBeInTheDocument();
  });

  it("a 409 ApiError toasts the error message", async () => {
    inviteMock.mockRejectedValue(new ApiError(409, "Esta pessoa já faz parte da equipe.", { error: "Esta pessoa já faz parte da equipe." }));
    render(<CreatorAccessActions creator={thais} onInstructions={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Convidar" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Convidar" });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("Esta pessoa já faz parte da equipe."));
  });
});
