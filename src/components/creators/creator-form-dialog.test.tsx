// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const createMock = vi.fn();
const updateMock = vi.fn();
vi.mock("@/hooks/use-creators", () => ({
  useCreateCreator: () => ({ mutateAsync: createMock, isPending: false }),
  useUpdateCreator: () => ({ mutateAsync: updateMock, isPending: false }),
}));

import { CreatorFormDialog } from "./creator-form-dialog";

const existing = {
  id: "c1",
  organizationId: "o1",
  userId: "u1",
  displayName: "Thais",
  instagramHandle: "@thais",
  email: "thais@x.com",
  createdAt: "2026-09-28T12:00:00.000Z",
  access: "invited" as const,
  lastLoginAt: null as string | null,
  emailEditable: true,
};

describe("CreatorFormDialog", () => {
  beforeEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
  });

  it("create: display name follows the full name until edited, then submits", async () => {
    const onSaved = vi.fn();
    createMock.mockResolvedValue({ ...existing, id: "c2" });
    render(<CreatorFormDialog open creator={null} onOpenChange={() => {}} onSaved={onSaved} />);

    expect(screen.getByRole("heading", { name: "Novo creator" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nome completo"), "Thais Rocha");
    expect(screen.getByLabelText("Nome de exibição")).toHaveValue("Thais Rocha");
    await userEvent.clear(screen.getByLabelText("Nome de exibição"));
    await userEvent.type(screen.getByLabelText("Nome de exibição"), "Thais");
    await userEvent.type(screen.getByLabelText("Nome completo"), " S");
    expect(screen.getByLabelText("Nome de exibição")).toHaveValue("Thais");
    await userEvent.type(screen.getByLabelText("@Instagram"), "thais");
    await userEvent.type(screen.getByLabelText("E-mail"), "thais@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar" }));

    expect(createMock).toHaveBeenCalledWith({ fullName: "Thais Rocha S", displayName: "Thais", instagramHandle: "thais", email: "thais@x.com" });
    expect(onSaved).toHaveBeenCalledWith({ ...existing, id: "c2" }, "create");
  });

  it("shows server field errors, including the 409 under E-mail", async () => {
    createMock.mockRejectedValueOnce(new ApiError(409, "Já existe um creator com este e-mail.", { error: "Já existe um creator com este e-mail." }));
    render(<CreatorFormDialog open creator={null} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText("Nome completo"), "Thais");
    await userEvent.type(screen.getByLabelText("E-mail"), "thais@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar" }));

    expect(await screen.findByText("Já existe um creator com este e-mail.")).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("aria-invalid", "true");

    createMock.mockRejectedValueOnce(new ApiError(400, "Bad Request", { errors: { instagramHandle: ["Use só letras, números, ponto e sublinhado (até 30)."] } }));
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar" }));
    expect(await screen.findByText("Use só letras, números, ponto e sublinhado (até 30).")).toBeInTheDocument();
    expect(screen.getByLabelText("@Instagram")).toHaveAccessibleDescription("Use só letras, números, ponto e sublinhado (até 30).");
  });

  it("shows a form-level error for a 403 with no errors body, leaving E-mail untouched", async () => {
    createMock.mockRejectedValueOnce(new ApiError(403, "Sem permissão.", { error: "Sem permissão." }));
    render(<CreatorFormDialog open creator={null} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText("Nome completo"), "Thais");
    await userEvent.type(screen.getByLabelText("E-mail"), "thais@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sem permissão.");
    expect(screen.getByLabelText("E-mail").getAttribute("aria-invalid")).not.toBe("true");
  });

  it("edit: e-mail input is enabled when emailEditable, only display fields sent when e-mail unchanged", async () => {
    const onSaved = vi.fn();
    updateMock.mockResolvedValue({ ...existing, displayName: "Thais R." });
    render(<CreatorFormDialog open creator={existing} onOpenChange={() => {}} onSaved={onSaved} />);

    expect(screen.getByRole("heading", { name: "Editar creator" })).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toBeEnabled();
    expect(screen.getByLabelText("E-mail")).toHaveValue("thais@x.com");
    expect(screen.queryByLabelText("Nome completo")).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Nome de exibição"));
    await userEvent.type(screen.getByLabelText("Nome de exibição"), "Thais R.");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(updateMock).toHaveBeenCalledWith({ displayName: "Thais R.", instagramHandle: "@thais" });
    expect(onSaved).toHaveBeenCalledWith({ ...existing, displayName: "Thais R." }, "edit");
  });

  it("edit: the e-mail input is disabled when emailEditable is false", () => {
    render(<CreatorFormDialog open creator={{ ...existing, emailEditable: false }} onOpenChange={() => {}} onSaved={() => {}} />);
    expect(screen.getByLabelText("E-mail")).toBeDisabled();
  });

  it("edit: saving with a changed e-mail sends it in the PATCH", async () => {
    const onSaved = vi.fn();
    updateMock.mockResolvedValue({ ...existing, email: "novo@x.com" });
    render(<CreatorFormDialog open creator={existing} onOpenChange={() => {}} onSaved={onSaved} />);

    await userEvent.clear(screen.getByLabelText("E-mail"));
    await userEvent.type(screen.getByLabelText("E-mail"), "novo@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(updateMock).toHaveBeenCalledWith({ displayName: "Thais", instagramHandle: "@thais", email: "novo@x.com" });
  });

  it("edit: an e-mail changed only in case/whitespace is treated as unchanged", async () => {
    updateMock.mockResolvedValue(existing);
    render(<CreatorFormDialog open creator={existing} onOpenChange={() => {}} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText("E-mail"));
    await userEvent.type(screen.getByLabelText("E-mail"), "  THAIS@X.com  ");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(updateMock).toHaveBeenCalledWith({ displayName: "Thais", instagramHandle: "@thais" });
  });

  it("edit: a 409 on e-mail conflict appears under E-mail", async () => {
    updateMock.mockRejectedValueOnce(
      new ApiError(409, "Já existe um creator com este e-mail.", { error: "Já existe um creator com este e-mail." }),
    );
    render(<CreatorFormDialog open creator={existing} onOpenChange={() => {}} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText("E-mail"));
    await userEvent.type(screen.getByLabelText("E-mail"), "novo@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Já existe um creator com este e-mail.")).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("aria-invalid", "true");
  });
});
