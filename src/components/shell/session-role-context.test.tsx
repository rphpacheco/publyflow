// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionRoleProvider, useIsCreator, useSessionRole } from "./session-role-context";

function Probe() {
  const isCreator = useIsCreator();
  return <span>{isCreator ? "creator" : "not-creator"}</span>;
}

describe("useIsCreator", () => {
  it("is true under role=CREATOR", () => {
    render(
      <SessionRoleProvider role="CREATOR">
        <Probe />
      </SessionRoleProvider>,
    );
    expect(screen.getByText("creator")).toBeInTheDocument();
  });

  it("is false under role=OWNER", () => {
    render(
      <SessionRoleProvider role="OWNER">
        <Probe />
      </SessionRoleProvider>,
    );
    expect(screen.getByText("not-creator")).toBeInTheDocument();
  });
});

describe("useSessionRole", () => {
  it("throws outside the provider", () => {
    function Boom() {
      useSessionRole();
      return null;
    }
    expect(() => render(<Boom />)).toThrow("useSessionRole must be used within a SessionRoleProvider");
  });
});
