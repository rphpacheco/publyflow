import { describe, it, expect, afterEach, vi } from "vitest";
import { getDevOrganizationId } from "./organization";

describe("getDevOrganizationId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the configured organization id", () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_ORGANIZATION_ID", "11111111-1111-1111-1111-111111111111");
    expect(getDevOrganizationId()).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("throws an explicit error when the env var is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_ORGANIZATION_ID", "");
    expect(() => getDevOrganizationId()).toThrow(/NEXT_PUBLIC_DEV_ORGANIZATION_ID/);
  });
});
