// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox } from "./combobox";

interface Company {
  id: string;
  name: string;
}

const companies: Company[] = [
  { id: "c1", name: "Bella Cosméticos" },
  { id: "c2", name: "Studio Norte" },
];

describe("Combobox", () => {
  it("opens on trigger click, filters by typed text, and calls onSelect for the chosen item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <Combobox<Company>
        items={companies}
        getLabel={(c) => c.name}
        getValue={(c) => c.id}
        value={null}
        onSelect={onSelect}
        placeholder="Selecionar empresa..."
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText(/Buscar/), "Norte");

    expect(screen.queryByText("Bella Cosméticos")).not.toBeInTheDocument();
    const option = await screen.findByText("Studio Norte");
    await user.click(option);

    expect(onSelect).toHaveBeenCalledWith(companies[1]);
  });

  it("shows a create-new option when onCreateNew is provided and no item matches", async () => {
    const user = userEvent.setup();
    const onCreateNew = vi.fn();

    render(
      <Combobox<Company>
        items={companies}
        getLabel={(c) => c.name}
        getValue={(c) => c.id}
        value={null}
        onSelect={() => {}}
        onCreateNew={onCreateNew}
        createLabel={(name) => `Criar "${name}"`}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText(/Buscar/), "Empresa Nova");

    const createOption = await screen.findByText('Criar "Empresa Nova"');
    await user.click(createOption);

    expect(onCreateNew).toHaveBeenCalledWith("Empresa Nova");
  });
});
