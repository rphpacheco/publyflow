// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const inviteMock = vi.fn();
vi.mock("@/hooks/use-team", () => ({
  useInviteManager: () => ({ mutateAsync: inviteMock, isPending: false }),
}));

import { InviteManagerDialog } from "./invite-manager-dialog";

async function fill(name: string, email: string) {
  await userEvent.type(screen.getByLabelText("Nome completo"), name);
  await userEvent.type(screen.getByLabelText("E-mail"), email);
}

describe("InviteManagerDialog", () => {
  beforeEach(() => inviteMock.mockReset());

  it("shows 400 field errors under each input", async () => {
    inviteMock.mockRejectedValueOnce(
      new ApiError(400, "Informe o nome.", { errors: { fullName: ["Informe o nome."], email: ["Informe um e-mail válido."] } }),
    );
    render(<InviteManagerDialog open onOpenChange={vi.fn()} onInvited={vi.fn()} />);
    await fill("x", "y");
    await userEvent.click(screen.getByRole("button", { name: "Convidar" }));
    const nameError = await screen.findByText("Informe o nome.");
    expect(nameError).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText("Nome completo")).toHaveAttribute("aria-describedby", nameError.id);
    const emailError = screen.getByText("Informe um e-mail válido.");
    expect(emailError).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("aria-describedby", emailError.id);
  });

  it("shows a 409 message inside the dialog and keeps it open", async () => {
    inviteMock.mockRejectedValueOnce(new ApiError(409, "Essa pessoa já faz parte da equipe.", { error: "x", code: "ALREADY_IN_TEAM" }));
    const onOpenChange = vi.fn();
    render(<InviteManagerDialog open onOpenChange={onOpenChange} onInvited={vi.fn()} />);
    await fill("Ana", "ana@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Convidar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Essa pessoa já faz parte da equipe.");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows a 502 message", async () => {
    inviteMock.mockRejectedValueOnce(
      new ApiError(502, "Não foi possível liberar o acesso agora. Tente novamente.", { code: "AUTH_PROVISIONING_FAILED" }),
    );
    render(<InviteManagerDialog open onOpenChange={vi.fn()} onInvited={vi.fn()} />);
    await fill("Ana", "ana@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Convidar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível liberar o acesso agora.");
  });

  it("on success closes and reports the invited email and message", async () => {
    inviteMock.mockResolvedValue({ member: { email: "ana@x.com" }, loginUrl: "l", message: "Olá, Ana!" });
    const onOpenChange = vi.fn();
    const onInvited = vi.fn();
    render(<InviteManagerDialog open onOpenChange={onOpenChange} onInvited={onInvited} />);
    await fill("Ana", "ana@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Convidar" }));
    await vi.waitFor(() => expect(onInvited).toHaveBeenCalledWith({ email: "ana@x.com", message: "Olá, Ana!" }));
    expect(inviteMock).toHaveBeenCalledWith({ fullName: "Ana", email: "ana@x.com" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Cancelar closes", async () => {
    const onOpenChange = vi.fn();
    render(<InviteManagerDialog open onOpenChange={onOpenChange} onInvited={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
