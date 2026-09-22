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
});
