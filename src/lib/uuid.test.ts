import { describe, it, expect } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts lower- and upper-case UUIDs", () => {
    expect(isUuid("2fb4820a-6d42-4d72-bdee-256c8d6189d2")).toBe(true);
    expect(isUuid("2FB4820A-6D42-4D72-BDEE-256C8D6189D2")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("abc")).toBe(false);
    expect(isUuid("2fb4820a6d424d72bdee256c8d6189d2")).toBe(false);
    expect(isUuid("2fb4820a-6d42-4d72-bdee-256c8d6189d2a")).toBe(false);
    expect(isUuid(" 2fb4820a-6d42-4d72-bdee-256c8d6189d2")).toBe(false);
  });
});
