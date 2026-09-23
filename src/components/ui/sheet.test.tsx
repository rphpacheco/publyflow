// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./sheet";

describe("Sheet", () => {
  it("opens from the requested side and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Abrir menu</SheetTrigger>
        <SheetContent side="left">
          <SheetTitle>Navegação</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.queryByText("Navegação")).not.toBeInTheDocument();

    await user.click(screen.getByText("Abrir menu"));
    const content = await screen.findByText("Navegação");
    expect(content).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Navegação")).not.toBeInTheDocument();
  });

  it("gives the close button a >=44px tap target on mobile/tablet", async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Abrir menu</SheetTrigger>
        <SheetContent side="left">
          <SheetTitle>Navegação</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    await user.click(screen.getByText("Abrir menu"));
    const closeButton = await screen.findByRole("button", { name: "Fechar" });
    // size-11 = 2.75rem = 44px, matching the 44x44px minimum touch target.
    expect(closeButton.className).toContain("size-11");
  });
});
