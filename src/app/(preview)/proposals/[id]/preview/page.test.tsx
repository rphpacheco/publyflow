import { describe, it, expect, vi } from "vitest";
import {
  isHTTPAccessFallbackError,
  getAccessFallbackHTTPStatus,
} from "next/dist/client/components/http-access-fallback/http-access-fallback";

vi.mock("@/lib/auth/require-app-session", () => ({
  requireAppSession: async () => ({ userId: "u1", organizationId: "o1", role: "OWNER" }),
}));

import ProposalPreviewPage from "./page";

describe("ProposalPreviewPage", () => {
  it("answers Next's not-found for a malformed id, before any DB lookup", async () => {
    let caught: unknown;
    try {
      await ProposalPreviewPage({
        params: Promise.resolve({ id: "not-a-uuid" }),
        searchParams: Promise.resolve({}),
      });
    } catch (error) {
      caught = error;
    }

    expect(isHTTPAccessFallbackError(caught)).toBe(true);
    if (isHTTPAccessFallbackError(caught)) {
      expect(getAccessFallbackHTTPStatus(caught)).toBe(404);
    }
  });
});
