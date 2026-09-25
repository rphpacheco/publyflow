import { describe, it, expect } from "vitest";
import { parseThemeParam, themeParamValue } from "./theme-param";

describe("theme param", () => {
  it("parses case-insensitively and rejects unknown values", () => {
    expect(parseThemeParam("editorial")).toBe("EDITORIAL");
    expect(parseThemeParam("FASHION")).toBe("FASHION");
    expect(parseThemeParam(["beauty", "minimal"])).toBe("BEAUTY");
    expect(parseThemeParam("neon")).toBeNull();
    expect(parseThemeParam("")).toBeNull();
    expect(parseThemeParam(undefined)).toBeNull();
  });

  it("writes the lowercase value", () => {
    expect(themeParamValue("CORPORATE")).toBe("corporate");
  });
});
