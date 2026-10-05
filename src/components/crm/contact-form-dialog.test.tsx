// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const mutateAsync = vi.fn();
vi.mock("@/hooks/use-crm", () => ({
  useUpdateContact: () => ({ mutateAsync, isPending: false }),
  useCompanies: () => ({ data: [{ id: "c1", name: "Bella" }] }),
}));

import { ContactFormDialog } from "./contact-form-dialog";

const contact = { id: "p1", companyId: "c1", fullName: "Maria", email: "m@x.com", phone: null, instagramHandle: null, createdAt: "2026-10-01T00:00:00.000Z" };

describe("ContactFormDialog", () => {
  beforeEach(() => mutateAsync.mockReset());

  it("submits all fields with empty strings for blanks", async () => {
    mutateAsync.mockResolvedValue({ ...contact, fullName: "Maria F." });
    const onSaved = vi.fn();
    render(<ContactFormDialog open contact={contact} onOpenChange={() => {}} onSaved={onSaved} />);
    const name = screen.getByLabelText("Nome");
    await userEvent.clear(name);
    await userEvent.type(name, "Maria F.");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(mutateAsync).toHaveBeenCalledWith({ fullName: "Maria F.", email: "m@x.com", phone: "", instagramHandle: "", companyId: "c1" });
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows a 400 e-mail error under the e-mail field", async () => {
    mutateAsync.mockRejectedValueOnce(new ApiError(400, "Informe um e-mail válido.", { errors: { email: ["Informe um e-mail válido."] } }));
    render(<ContactFormDialog open contact={contact} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Informe um e-mail válido.")).toBeTruthy();
  });
});
