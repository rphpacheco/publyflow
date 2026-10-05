// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const replace = vi.fn();
let isCreator = false;
let contacts: unknown[] | undefined = [];
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("@/components/shell/session-role-context", () => ({ useIsCreator: () => isCreator }));
vi.mock("@/hooks/use-crm", () => ({
  useContacts: () => ({ data: contacts, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import ContactsPage from "./page";

const maria = {
  id: "p1",
  fullName: "Maria Fernandes",
  email: "maria@bella.com",
  phone: "48 9999",
  instagramHandle: "@maria.f",
  companyId: "c1",
  companyName: "Bella",
  createdAt: "2026-10-01T12:00:00.000Z",
};
const joao = {
  id: "p2",
  fullName: "João",
  email: null,
  phone: null,
  instagramHandle: null,
  companyId: null,
  companyName: null,
  createdAt: "2026-10-02T12:00:00.000Z",
};

describe("ContactsPage", () => {
  beforeEach(() => {
    isCreator = false;
    contacts = [maria, joao];
    push.mockReset();
    replace.mockReset();
  });

  it("lists contacts and filters by name, instagram and e-mail", async () => {
    render(<ContactsPage />);
    expect(screen.getByText("Maria Fernandes")).toBeTruthy();
    expect(screen.getByText("João")).toBeTruthy();
    const box = screen.getByRole("searchbox", { name: "Buscar contato" });
    await userEvent.type(box, "@maria");
    expect(screen.queryByText("João")).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, "bella.com");
    expect(screen.getByText("Maria Fernandes")).toBeTruthy();
    expect(screen.queryByText("João")).toBeNull();
  });

  it("navigates to the detail on row click", async () => {
    render(<ContactsPage />);
    await userEvent.click(screen.getByText("Maria Fernandes"));
    expect(push).toHaveBeenCalledWith("/contacts/p1");
  });

  it("shows the empty state pointing to the inbox", () => {
    contacts = [];
    render(<ContactsPage />);
    expect(screen.getByText("Nenhum contato ainda")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ir para o Inbox" }).getAttribute("href")).toBe("/inbox");
  });

  it("redirects a creator to the pipeline", () => {
    isCreator = true;
    render(<ContactsPage />);
    expect(replace).toHaveBeenCalledWith("/pipeline");
  });
});
