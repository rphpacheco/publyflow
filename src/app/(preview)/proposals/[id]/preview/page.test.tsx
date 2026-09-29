import { describe, it, expect, afterAll, vi } from "vitest";
import {
  isHTTPAccessFallbackError,
  getAccessFallbackHTTPStatus,
} from "next/dist/client/components/http-access-fallback/http-access-fallback";
import { withTestDb } from "@/test/helpers/db";
import { creatorSession, ownerSession } from "@/test/helpers/route";
import { seedTwoCreators } from "@/test/helpers/two-creators";
import type { Session } from "@/lib/auth/types";

type PageComponent = (props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ theme?: string | string[] }>;
}) => Promise<unknown>;

async function loadPageWithSession(db: unknown, session: Session | null): Promise<PageComponent> {
  vi.resetModules();
  vi.doMock("@/db", () => ({ db }));
  vi.doMock("@/lib/auth/session", () => ({
    getSession: async () => session,
  }));
  const mod = await import("./page");
  return mod.default as PageComponent;
}

describe("ProposalPreviewPage", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterAll(async () => cleanup?.());

  it("answers Next's not-found for a malformed id, before any DB lookup", async () => {
    const Page = await loadPageWithSession(null, ownerSession("o1", "u1"));

    let caught: unknown;
    try {
      await Page({
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

  it("CREATOR session: another creator's proposal answers not-found, its own renders", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedTwoCreators(db);
    const session = creatorSession(seeded.organization.id, seeded.x.user.id, seeded.x.creator.id);

    const Page = await loadPageWithSession(db, session);

    let caught: unknown;
    try {
      await Page({
        params: Promise.resolve({ id: seeded.y.proposal.id }),
        searchParams: Promise.resolve({}),
      });
    } catch (error) {
      caught = error;
    }
    expect(isHTTPAccessFallbackError(caught)).toBe(true);
    if (isHTTPAccessFallbackError(caught)) {
      expect(getAccessFallbackHTTPStatus(caught)).toBe(404);
    }

    // Own proposal: must not throw Next's not-found.
    let ownResult: unknown;
    let ownError: unknown;
    try {
      ownResult = await Page({
        params: Promise.resolve({ id: seeded.x.proposal.id }),
        searchParams: Promise.resolve({}),
      });
    } catch (error) {
      ownError = error;
    }
    expect(isHTTPAccessFallbackError(ownError)).toBe(false);
    expect(ownResult).toBeDefined();
  });
});
