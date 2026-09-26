import { describe, it, expect } from "vitest";
import { isPublicPath } from "./public-paths";

describe("isPublicPath", () => {
  it.each(["/login", "/sem-acesso", "/auth/callback", "/auth/signout", "/p/abc", "/p"])("%s is public", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(["/", "/pipeline", "/inbox", "/proposals/abc", "/loginx", "/authors"])("%s is protected", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
