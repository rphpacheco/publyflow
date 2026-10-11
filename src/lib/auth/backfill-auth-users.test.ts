import { describe, it, expect, afterEach, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { organizations, organizationMembers, users } from "@/db/schema/organizations";
import type { AuthAdmin } from "./auth-admin";
import { backfillAuthUsers, checkAuthUsers, describeTarget } from "./backfill-auth-users";

const OWNER_AUTH_ID = "11111111-1111-4111-8111-111111111111";
const MANAGER_AUTH_ID = "22222222-2222-4222-8222-222222222222";
const CREATOR_AUTH_ID = "33333333-3333-4333-8333-333333333333";

describe("backfill auth users", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function seed() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const insertUser = async (email: string, authUserId?: string) =>
      (await db.insert(users).values({ email, fullName: email, authUserId }).returning())[0];
    const owner = await insertUser("Owner@publyflow.test", OWNER_AUTH_ID);
    const manager = await insertUser("Manager@publyflow.test");
    const creator = await insertUser("creator@publyflow.test");
    await insertUser("nomember@publyflow.test");
    const invited = await insertUser("invited@publyflow.test");
    await db.insert(organizationMembers).values([
      { organizationId: org.id, userId: owner.id, role: "OWNER" },
      { organizationId: org.id, userId: manager.id, role: "MANAGER" },
      { organizationId: org.id, userId: creator.id, role: "CREATOR" },
      { organizationId: org.id, userId: invited.id, role: "CREATOR" },
    ]);
    return { db, manager, creator };
  }

  function fakeAdmin(ensure?: AuthAdmin["ensureAuthUser"]) {
    const ensureAuthUser = vi.fn(
      ensure ??
        (async (email: string) => ({
          authUserId: email.startsWith("manager") ? MANAGER_AUTH_ID : CREATOR_AUTH_ID,
          created: true,
        })),
    );
    const admin: AuthAdmin = {
      ensureAuthUser,
      listAuthEmails: async () => new Set(["owner@publyflow.test", "invited@publyflow.test"]),
    };
    return { admin, ensureAuthUser };
  }

  it("checkAuthUsers reports missing members and writes nothing", async () => {
    const { db } = await seed();
    const { admin, ensureAuthUser } = fakeAdmin();
    const before = await db.execute(sql`select count(*) as n, count(auth_user_id) as linked from users`);

    const result = await checkAuthUsers(db, admin);

    expect(result).toEqual({
      missingInAuth: ["creator@publyflow.test", "manager@publyflow.test"],
      unlinked: 3,
    });
    expect(ensureAuthUser).not.toHaveBeenCalled();
    const after = await db.execute(sql`select count(*) as n, count(auth_user_id) as linked from users`);
    expect(after.rows).toEqual(before.rows);
  });

  it("backfillAuthUsers creates both but links only the manager", async () => {
    const { db, manager, creator } = await seed();
    const { admin, ensureAuthUser } = fakeAdmin();

    const result = await backfillAuthUsers(db, admin);

    expect(ensureAuthUser.mock.calls.map((c) => c[0]).sort()).toEqual([
      "creator@publyflow.test",
      "manager@publyflow.test",
    ]);
    expect(result).toEqual({
      created: ["creator@publyflow.test", "manager@publyflow.test"],
      linked: ["manager@publyflow.test"],
      failed: [],
    });
    const [m] = await db.select().from(users).where(eq(users.id, manager.id));
    const [c] = await db.select().from(users).where(eq(users.id, creator.id));
    expect(m.authUserId).toBe(MANAGER_AUTH_ID);
    expect(c.authUserId).toBeNull();
  });

  it("records a failing e-mail and keeps going", async () => {
    const { db, manager } = await seed();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = fakeAdmin(async (email) => {
      if (email.startsWith("creator")) throw new Error("boom");
      return { authUserId: MANAGER_AUTH_ID, created: true };
    });

    const result = await backfillAuthUsers(db, admin);

    expect(result).toEqual({
      created: ["manager@publyflow.test"],
      linked: ["manager@publyflow.test"],
      failed: ["creator@publyflow.test"],
    });
    expect(errorSpy).toHaveBeenCalledWith("backfill failed for creator@publyflow.test:", "boom");
    errorSpy.mockRestore();
    const [m] = await db.select().from(users).where(eq(users.id, manager.id));
    expect(m.authUserId).toBe(MANAGER_AUTH_ID);
  });
});

describe("describeTarget", () => {
  it("prints the supabase host and db host:port/name without credentials", () => {
    const out = describeTarget(
      "https://abcd1234.supabase.co",
      "postgresql://postgres.abcd:S3cr3t%21pw@aws-0-sa.pooler.supabase.com:6543/postgres?sslmode=require",
    );
    expect(out).toBe("Target: supabase=abcd1234.supabase.co db=aws-0-sa.pooler.supabase.com:6543/postgres");
    expect(out).not.toContain("S3cr3t");
    expect(out).not.toContain("postgres.abcd");
  });

  it("never echoes an unparseable value (it may embed a password)", () => {
    const out = describeTarget("not a url", "also not a url S3cr3t");
    expect(out).toBe("Target: supabase=invalid-url db=invalid-url");
  });
});
