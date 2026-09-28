import { describe, it, expect } from "vitest";
import { clientIp } from "./client-ip";

describe("clientIp", () => {
  it("prefers x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
  });

  it("falls back to the first x-forwarded-for value, trimmed", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" }))).toBe("198.51.100.1");
  });

  it("returns null without either header", () => {
    expect(clientIp(new Headers())).toBeNull();
  });
});
