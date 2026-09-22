// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
}));

import { SidebarDesktop, SidebarMobile, SIDEBAR_NAV_ITEMS } from "./sidebar";

describe("SidebarDesktop", () => {
  it("renders every top-level nav item and marks the current route as active", () => {
    render(<SidebarDesktop />);

    for (const item of SIDEBAR_NAV_ITEMS) {
      expect(screen.getByRole("link", { name: new RegExp(item.label) })).toBeInTheDocument();
    }

    const activeLink = screen.getByRole("link", { name: /Inbox/ });
    expect(activeLink.className).toContain("text-primary");
  });
});

describe("SidebarMobile", () => {
  it("opens the navigation drawer when the menu trigger is tapped", async () => {
    const user = userEvent.setup();
    render(<SidebarMobile />);

    await user.click(screen.getByRole("button", { name: "Abrir menu" }));
    expect(await screen.findByRole("link", { name: /Pipeline/ })).toBeInTheDocument();
  });
});
