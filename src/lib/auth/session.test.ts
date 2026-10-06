import { describe, it, expect, afterEach, vi } from "vitest";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";

async function importSessionModule(options: {
  db: Awaited<ReturnType<typeof withTestDb>>["db"];
  authUser?: { id: string; email?: string; email_confirmed_at?: string } | null;
  // Overrides authUser: what supabase.auth.getUser() resolves to (or throws).
  getUser?: () => Promise<unknown>;
}) {
  vi.resetModules();
  vi.doMock("@/db", () => ({ db: options.db }));
  const getUser = vi.fn(
    options.getUser ??
      (async () =>
        options.authUser
          ? { data: { user: options.authUser }, error: null }
          : { data: { user: null }, error: { message: "no session" } }),
  );
  vi.doMock("@/lib/supabase/server", () => ({
    createSupabaseServerClient: async () => ({ auth: { getUser } }),
  }));
  const mod = await import("./session");
  return { ...mod, getUser };
}

describe("getSession / requireSession", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns the resolved session for an authenticated, provisioned user", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });

    const { getSession, requireSession } = await importSessionModule({
      db,
      authUser: {
        id: "55555555-5555-4555-8555-555555555555",
        email: "owner@publyflow.test",
        email_confirmed_at: "2026-01-01T00:00:00Z",
      },
    });

    const expected = { userId: owner.id, organizationId: organization.id, role: "OWNER", creatorId: null };
    expect(await getSession()).toEqual(expected);
    expect(await requireSession()).toEqual(expected);
  });

  it("returns null / throws UnauthenticatedError when there is no Supabase user", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { getSession, requireSession } = await importSessionModule({ db, authUser: null });
    const { UnauthenticatedError } = await import("./errors");

    expect(await getSession()).toBeNull();
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("returns null for an authenticated but unprovisioned user", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { getSession } = await importSessionModule({
      db,
      authUser: {
        id: "66666666-6666-4666-8666-666666666666",
        email: "stranger@x.test",
        email_confirmed_at: "2026-01-01T00:00:00Z",
      },
    });

    expect(await getSession()).toBeNull();
  });

  it("returns null for a matching but unconfirmed e-mail", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });

    const { getSession } = await importSessionModule({
      db,
      authUser: { id: "99999999-9999-4999-8999-999999999999", email: "owner@publyflow.test" },
    });

    expect(await getSession()).toBeNull();
  });
});

describe("getAuthState", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("is anonymous when there is no Supabase user", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { getAuthState } = await importSessionModule({ db, authUser: null });
    expect(await getAuthState()).toEqual({ status: "anonymous" });
  });

  it("is member with the resolved session for a provisioned user", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const { getAuthState } = await importSessionModule({
      db,
      authUser: {
        id: "55555555-5555-4555-8555-555555555555",
        email: "owner@publyflow.test",
        email_confirmed_at: "2026-01-01T00:00:00Z",
      },
    });
    expect(await getAuthState()).toEqual({
      status: "member",
      session: { userId: owner.id, organizationId: organization.id, role: "OWNER", creatorId: null },
    });
  });

  it("is no-access with the e-mail for a Supabase user without membership", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { getAuthState } = await importSessionModule({
      db,
      authUser: {
        id: "66666666-6666-4666-8666-666666666666",
        email: "stranger@x.test",
        email_confirmed_at: "2026-01-01T00:00:00Z",
      },
    });
    expect(await getAuthState()).toEqual({ status: "no-access", email: "stranger@x.test" });
  });

  it("is anonymous (not unavailable) when getUser answers 401 / invalid token", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { getAuthState, getSession } = await importSessionModule({
      db,
      getUser: async () => ({ data: { user: null }, error: { status: 401, message: "invalid" } }),
    });
    expect(await getAuthState()).toEqual({ status: "anonymous" });
    expect(await getSession()).toBeNull();
  });

  describe("auth provider outage -> AuthUnavailableError", () => {
    const outages: Array<[string, () => Promise<unknown>]> = [
      [
        "AuthRetryableFetchError",
        async () => ({ data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) }),
      ],
      ["5xx", async () => ({ data: { user: null }, error: { status: 503, message: "unavailable" } })],
      [
        "getUser throws TypeError",
        async () => {
          throw new TypeError("fetch failed");
        },
      ],
    ];

    for (const [label, getUser] of outages) {
      it(`${label}: getAuthState and getSession reject with AuthUnavailableError`, async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const { db, cleanup: c } = await withTestDb();
          cleanup = c;
          const { getAuthState, getSession, requireSession } = await importSessionModule({ db, getUser });
          const { AuthUnavailableError } = await import("./errors");
          await expect(getAuthState()).rejects.toBeInstanceOf(AuthUnavailableError);
          expect(warn).toHaveBeenCalledWith("auth provider unavailable", expect.any(String), expect.anything());
          await expect(getSession()).rejects.toBeInstanceOf(AuthUnavailableError);
          await expect(requireSession()).rejects.toBeInstanceOf(AuthUnavailableError);
        } finally {
          warn.mockRestore();
        }
      });
    }

    it("rethrows an unrelated error thrown by getUser", async () => {
      const { db, cleanup: c } = await withTestDb();
      cleanup = c;
      const boom = new Error("boom");
      const { getAuthState } = await importSessionModule({
        db,
        getUser: async () => {
          throw boom;
        },
      });
      await expect(getAuthState()).rejects.toBe(boom);
    });
  });
});
