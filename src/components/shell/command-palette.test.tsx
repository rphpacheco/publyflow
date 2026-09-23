// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { CommandPalette } from "./command-palette";

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

describe("CommandPalette", () => {
  afterEach(() => {
    setViewportWidth(ORIGINAL_INNER_WIDTH);
  });

  it("opens with Ctrl+K and navigates when a nav item is selected", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    expect(screen.queryByPlaceholderText(/Buscar ou executar/)).not.toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByPlaceholderText(/Buscar ou executar/)).toBeInTheDocument();

    await user.click(screen.getByText("Pipeline"));
    expect(push).toHaveBeenCalledWith("/pipeline");
  });

  it("opens when the visible trigger button is clicked", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.click(screen.getByText("Buscar..."));
    expect(await screen.findByPlaceholderText(/Buscar ou executar/)).toBeInTheDocument();
  });

  describe("on a mobile viewport", () => {
    beforeEach(() => {
      setViewportWidth(375);
    });

    it("opens a Sheet-based, bottom-anchored presentation instead of the centered Dialog", async () => {
      const user = userEvent.setup();
      render(<CommandPalette />);

      await user.click(screen.getByRole("button", { name: "Abrir busca" }));
      expect(await screen.findByPlaceholderText(/Buscar ou executar/)).toBeInTheDocument();

      // Dialog/Sheet content renders into a portal appended to
      // document.body, not under the RTL container, so query from there.
      // The Sheet's bottom-side content carries its distinctive positioning
      // classes (from sheetVariants' "bottom" variant) -- present only on
      // Sheet markup, never on the centered Dialog markup.
      const sheetContent = document.body.querySelector(".inset-x-0.bottom-0");
      expect(sheetContent).not.toBeNull();
      expect(sheetContent?.className).toContain("max-h-[85vh]");

      // The centered Dialog never mounts its content while the Sheet is the
      // active presentation, since only one of the two is ever `open`.
      expect(document.body.querySelector(".max-w-lg.p-0")).toBeNull();
    });
  });
});
