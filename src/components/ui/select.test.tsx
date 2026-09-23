// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

describe("Select", () => {
  it("opens on trigger click and selects an item", async () => {
    const user = userEvent.setup();
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Canal" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="INSTAGRAM">Instagram</SelectItem>
          <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
        </SelectContent>
      </Select>,
    );

    await user.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: "WhatsApp" });
    await user.click(option);

    expect(screen.getByRole("combobox")).toHaveTextContent("WhatsApp");
  });
});
