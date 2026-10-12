import { describe, it, expect, vi, beforeEach } from "vitest";

const { checkRateLimitMock } = vi.hoisted(() => ({ checkRateLimitMock: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/db", () => ({ db: { tag: "db" } }));

import { allowEmailLink } from "./email-link-limit";

const ok = { allowed: true, retryAfterSeconds: 0 };
const denied = { allowed: false, retryAfterSeconds: 30 };

describe("allowEmailLink", () => {
  beforeEach(() => checkRateLimitMock.mockReset().mockResolvedValue(ok));

  it("is true when both buckets allow, with exact scopes and keys", async () => {
    expect(await allowEmailLink("password-reset", "a@b.com", "1.2.3.4")).toBe(true);
    expect(checkRateLimitMock).toHaveBeenCalledWith({ tag: "db" }, { scope: "password-reset:ip", ip: "1.2.3.4", limit: 5, windowSeconds: 600 });
    expect(checkRateLimitMock).toHaveBeenCalledWith({ tag: "db" }, { scope: "password-reset:email", ip: "a@b.com", limit: 5, windowSeconds: 600 });
  });

  it("is false when the ip bucket denies", async () => {
    checkRateLimitMock.mockResolvedValueOnce(denied);
    expect(await allowEmailLink("magic-link", "a@b.com", "1.2.3.4")).toBe(false);
  });

  it("is false when the email bucket denies", async () => {
    checkRateLimitMock.mockResolvedValueOnce(ok).mockResolvedValueOnce(denied);
    expect(await allowEmailLink("magic-link", "a@b.com", "1.2.3.4")).toBe(false);
  });
});
