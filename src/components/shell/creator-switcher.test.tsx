// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Creator } from "@/repositories/creators.repository";
import { CreatorProvider } from "./creator-context";
import { CreatorSwitcher } from "./creator-switcher";

const creators: Creator[] = [
  {
    id: "c1",
    organizationId: "org1",
    userId: "u1",
    displayName: "Thais Miranda",
    instagramHandle: null,
    createdAt: new Date("2026-01-01"),
  },
  {
    id: "c2",
    organizationId: "org1",
    userId: "u2",
    displayName: "Bruno Alves",
    instagramHandle: null,
    createdAt: new Date("2026-01-02"),
  },
];

describe("CreatorSwitcher", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the first creator and switches selection on click, persisting it", async () => {
    const user = userEvent.setup();
    render(
      <CreatorProvider creators={creators}>
        <CreatorSwitcher />
      </CreatorProvider>,
    );

    expect(await screen.findByText("Thais Miranda")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Thais Miranda/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Bruno Alves/ }));

    expect(screen.getByRole("button", { name: /Bruno Alves/ })).toBeInTheDocument();
    expect(window.localStorage.getItem("publyflow:selected-creator-id")).toBe("c2");
  });

  it("shows a fallback message when the organization has no creators", () => {
    render(
      <CreatorProvider creators={[]}>
        <CreatorSwitcher />
      </CreatorProvider>,
    );

    expect(screen.getByText("Nenhum creator cadastrado")).toBeInTheDocument();
  });
});
