// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

describe("Popover", () => {
  it("opens on trigger click and shows its content", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Filtros</PopoverTrigger>
        <PopoverContent>Status: Aberto</PopoverContent>
      </Popover>,
    );

    expect(screen.queryByText("Status: Aberto")).not.toBeInTheDocument();

    await user.click(screen.getByText("Filtros"));
    expect(await screen.findByText("Status: Aberto")).toBeInTheDocument();
  });
});
