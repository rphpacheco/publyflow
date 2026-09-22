// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./dialog";

describe("Dialog", () => {
  it("opens on trigger click, shows its title/description, and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Excluir proposta</DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirmar exclusão</DialogTitle>
          <DialogDescription>Esta ação não pode ser desfeita.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByText("Confirmar exclusão")).not.toBeInTheDocument();

    await user.click(screen.getByText("Excluir proposta"));
    expect(await screen.findByText("Confirmar exclusão")).toBeInTheDocument();
    expect(screen.getByText("Esta ação não pode ser desfeita.")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Confirmar exclusão")).not.toBeInTheDocument();
  });
});
