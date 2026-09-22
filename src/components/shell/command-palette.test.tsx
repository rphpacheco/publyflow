// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { CommandPalette } from "./command-palette";

describe("CommandPalette", () => {
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
});
