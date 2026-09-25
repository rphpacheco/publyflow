import { describe, it, expect } from "vitest";
import { PROPOSAL_THEMES } from "@/lib/proposal-themes";
import { THEMES } from "./index";

describe("THEMES registry", () => {
  it("has a definition for every proposal theme, keyed by its own id", () => {
    for (const theme of PROPOSAL_THEMES) {
      expect(THEMES[theme]).toBeDefined();
      expect(THEMES[theme].id).toBe(theme);
    }
    expect(Object.keys(THEMES).sort()).toEqual([...PROPOSAL_THEMES].sort());
  });
});
