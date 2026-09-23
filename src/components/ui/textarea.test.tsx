// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("accepts typed multi-line text", async () => {
    const user = userEvent.setup();
    render(<Textarea placeholder="Mensagem..." />);
    const textarea = screen.getByPlaceholderText("Mensagem...");
    await user.type(textarea, "Olá, gostaríamos de saber os valores.");
    expect(textarea).toHaveValue("Olá, gostaríamos de saber os valores.");
  });

  it("respects the disabled attribute", () => {
    render(<Textarea disabled placeholder="Indisponível" />);
    expect(screen.getByPlaceholderText("Indisponível")).toBeDisabled();
  });
});
