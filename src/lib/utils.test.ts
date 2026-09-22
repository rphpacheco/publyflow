import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts (last one wins)", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("drops falsy values", () => {
    expect(cn("text-sm", false && "hidden", undefined, "font-medium")).toBe(
      "text-sm font-medium",
    );
  });
});
