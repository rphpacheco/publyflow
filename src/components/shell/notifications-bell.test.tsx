// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
let data: { items: unknown[]; unreadCount: number } | undefined;
const markRead = vi.fn();
const markAll = vi.fn();
vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({ data }),
  useMarkNotificationRead: () => ({ mutate: markRead }),
  useMarkAllNotificationsRead: () => ({ mutate: markAll, isPending: false }),
}));

import { NotificationsBell } from "./notifications-bell";

const item = {
  id: "n1",
  kind: "proposal.approved",
  title: "Proposta aceita",
  body: 'Maria aceitou "Campanha Verão".',
  linkPath: "/proposals/p1",
  readAt: null,
  createdAt: "2026-09-26T15:00:00.000Z",
};

describe("NotificationsBell", () => {
  beforeEach(() => {
    pushMock.mockReset();
    markRead.mockReset();
    markAll.mockReset();
  });

  it("shows the unread count and opens the list", async () => {
    data = { items: [item], unreadCount: 1 };
    render(<NotificationsBell />);
    expect(screen.getByRole("button", { name: "Notificações" })).toHaveTextContent("1");

    await userEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(screen.getByText("Proposta aceita")).toBeInTheDocument();
    expect(screen.getByText('Maria aceitou "Campanha Verão".')).toBeInTheDocument();
  });

  it("clicking an item marks it read and navigates", async () => {
    data = { items: [item], unreadCount: 1 };
    render(<NotificationsBell />);
    await userEvent.click(screen.getByRole("button", { name: "Notificações" }));
    await userEvent.click(screen.getByRole("button", { name: /Proposta aceita/ }));
    expect(markRead).toHaveBeenCalledWith("n1");
    expect(pushMock).toHaveBeenCalledWith("/proposals/p1");
  });

  it("marks all as read", async () => {
    data = { items: [item], unreadCount: 1 };
    render(<NotificationsBell />);
    await userEvent.click(screen.getByRole("button", { name: "Notificações" }));
    await userEvent.click(screen.getByRole("button", { name: "Marcar todas como lidas" }));
    expect(markAll).toHaveBeenCalled();
  });

  it("empty state and no badge", async () => {
    data = { items: [], unreadCount: 0 };
    render(<NotificationsBell />);
    expect(screen.getByRole("button", { name: "Notificações" })).not.toHaveTextContent(/\d/);
    await userEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(screen.getByText("Nenhuma notificação.")).toBeInTheDocument();
  });
});
