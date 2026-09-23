// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { Button } from "./button";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the title, optional description, and optional action", () => {
    render(
      <EmptyState
        icon={Inbox}
        title="Nenhuma mensagem nova"
        description="Novas mensagens comerciais aparecem aqui."
        action={<Button>Nova Mensagem</Button>}
      />,
    );

    expect(screen.getByText("Nenhuma mensagem nova")).toBeInTheDocument();
    expect(screen.getByText("Novas mensagens comerciais aparecem aqui.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova Mensagem" })).toBeInTheDocument();
  });

  it("renders without a description or action when omitted", () => {
    render(<EmptyState icon={Inbox} title="Nada por aqui" />);
    expect(screen.getByText("Nada por aqui")).toBeInTheDocument();
  });
});
