// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { AccessInstructionsDialog } from "./access-instructions-dialog";

const MESSAGE = "Olá, Thais! Você foi convidado(a) para acompanhar suas propostas no PublyFlow. Acesse http://x/login e entre com Google ou com um link enviado para thais@x.com.";

describe("AccessInstructionsDialog", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("shows the title and message in a read-only textarea", () => {
    render(<AccessInstructionsDialog open onOpenChange={() => {}} email="thais@x.com" message={MESSAGE} />);
    expect(screen.getByRole("heading", { name: "Instruções de acesso" })).toBeInTheDocument();
    const textarea = screen.getByLabelText("Mensagem de acesso");
    expect(textarea).toHaveValue(MESSAGE);
    expect(textarea).toHaveAttribute("readonly");
  });

  it("copies the message to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AccessInstructionsDialog open onOpenChange={() => {}} email="thais@x.com" message={MESSAGE} />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar mensagem" }));
    expect(writeText).toHaveBeenCalledWith(MESSAGE);
    expect(toastSuccess).toHaveBeenCalledWith("Mensagem copiada.");
  });

  it("renders the E-mail link with the exact mailto href", () => {
    render(<AccessInstructionsDialog open onOpenChange={() => {}} email="thais@x.com" message={MESSAGE} />);
    const link = screen.getByRole("link", { name: "E-mail" });
    expect(link).toHaveAttribute(
      "href",
      `mailto:thais%40x.com?subject=Acesso%20ao%20PublyFlow&body=${encodeURIComponent(MESSAGE)}`,
    );
  });
});
