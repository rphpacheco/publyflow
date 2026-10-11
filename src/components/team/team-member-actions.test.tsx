// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const remindMock = vi.fn();
const removeMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/hooks/use-team", () => ({
  useRemindManager: () => ({ mutateAsync: remindMock, isPending: false }),
  useRemoveManager: () => ({ mutateAsync: removeMock, isPending: false }),
}));

import { TeamMemberActions } from "./team-member-actions";

const member = { id: "u2", fullName: "Bia Gestora", email: "bia@x.com", role: "MANAGER" as const, status: "invited" as const, isSelf: false };

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Ações de Bia Gestora" }));
}

describe("TeamMemberActions", () => {
  beforeEach(() => {
    remindMock.mockReset();
    removeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("Reenviar acesso calls onInstructions with the message", async () => {
    remindMock.mockResolvedValue({ loginUrl: "l", message: "msg" });
    const onInstructions = vi.fn();
    render(<TeamMemberActions member={member} onInstructions={onInstructions} />);
    await openMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Reenviar acesso" }));
    await vi.waitFor(() => expect(onInstructions).toHaveBeenCalledWith({ email: "bia@x.com", message: "msg" }));
    expect(remindMock).toHaveBeenCalledWith({ memberId: "u2" });
  });

  it("shows a toast when resend fails", async () => {
    remindMock.mockRejectedValueOnce(new ApiError(409, "Só é possível reenviar o acesso de um gestor."));
    render(<TeamMemberActions member={member} onInstructions={vi.fn()} />);
    await openMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Reenviar acesso" }));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("Só é possível reenviar o acesso de um gestor."));
  });

  it("Remover acesso asks for confirmation then removes and toasts", async () => {
    removeMock.mockResolvedValue(undefined);
    render(<TeamMemberActions member={member} onInstructions={vi.fn()} />);
    await openMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remover acesso" }));
    expect(await screen.findByText("Remover o acesso de Bia Gestora? A pessoa perde o acesso imediatamente.")).toBeInTheDocument();
    expect(removeMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remover" }));
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Acesso removido."));
    expect(removeMock).toHaveBeenCalledWith({ memberId: "u2" });
  });

  it("shows a toast when removal fails", async () => {
    removeMock.mockRejectedValueOnce(new ApiError(409, "Não é possível remover um proprietário."));
    render(<TeamMemberActions member={member} onInstructions={vi.fn()} />);
    await openMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remover acesso" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remover" }));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("Não é possível remover um proprietário."));
  });
});
