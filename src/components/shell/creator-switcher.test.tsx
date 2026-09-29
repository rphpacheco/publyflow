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

  it("defaults to the first creator and switches selection on click, persisting it under an organization-namespaced key", async () => {
    const user = userEvent.setup();
    render(
      <CreatorProvider organizationId="org1" creators={creators}>
        <CreatorSwitcher />
      </CreatorProvider>,
    );

    expect(await screen.findByText("Thais Miranda")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Thais Miranda/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Bruno Alves/ }));

    expect(screen.getByRole("button", { name: /Bruno Alves/ })).toBeInTheDocument();
    expect(window.localStorage.getItem("publyflow:org1:selected-creator-id")).toBe("c2");
  });

  it("does not leak a selection stored for one organization into another", async () => {
    window.localStorage.setItem("publyflow:org1:selected-creator-id", "c2");

    render(
      <CreatorProvider organizationId="org2" creators={creators}>
        <CreatorSwitcher />
      </CreatorProvider>,
    );

    // org2 has no stored selection under its own key, so it must fall back
    // to the first creator rather than reusing org1's "Bruno Alves".
    expect(await screen.findByText("Thais Miranda")).toBeInTheDocument();
  });

  it("offers a link to register a creator when the organization has none", () => {
    render(
      <CreatorProvider organizationId="org1" creators={[]}>
        <CreatorSwitcher />
      </CreatorProvider>,
    );

    const link = screen.getByRole("link", { name: "Cadastrar creator" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/creators");
  });
});
