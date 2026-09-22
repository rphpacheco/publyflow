// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./dropdown-menu";

describe("DropdownMenu", () => {
  it("opens on trigger click and calls onSelect for the chosen item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Thais Miranda</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Creators</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onSelect}>Bruno Alves</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.queryByText("Bruno Alves")).not.toBeInTheDocument();

    await user.click(screen.getByText("Thais Miranda"));
    const item = await screen.findByText("Bruno Alves");
    await user.click(item);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
