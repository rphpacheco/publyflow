import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";

async function importSessionModule(options: {
  db: Awaited<ReturnType<typeof withTestDb>>["db"];
  authUser: { id: string; email?: string; email_confirmed_at?: string } | null;
}) {
  vi.resetModules();
  vi.doMock("@/db", () => ({ db: options.db }));
  vi.doMock("@/lib/supabase/server", () => ({
    createSupabaseServerClient: async () => ({
      auth: {
        getUser: async () =>
          options.authUser
            ? { data: { user: options.authUser }, error: null }
            : { data: { user: null }, error: { message: "no session" } },
      },
    }),
  }));
  return import("./session");
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

    const expected = { userId: owner.id, organizationId: organization.id, role: "OWNER" };
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
