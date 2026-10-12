import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { organizationMembers, users } from "./schema/organizations";
import { creators } from "./schema/creators";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { CreatorsRepository } from "@/repositories/creators.repository";

type Db = Awaited<ReturnType<typeof withTestDb>>["db"];

let counter = 0;

async function seedTwoOrgsAndUser(db: Db) {
  counter += 1;
  const suffix = `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  const { organization: a } = await OrganizationService.createWithOwner(db, {
    organizationName: `Org A ${suffix}`,
    ownerEmail: `owner-a-${suffix}@publyflow.test`,
    ownerFullName: "Owner A",
  });
  const { organization: b } = await OrganizationService.createWithOwner(db, {
    organizationName: `Org B ${suffix}`,
    ownerEmail: `owner-b-${suffix}@publyflow.test`,
    ownerFullName: "Owner B",
  });
  const [user] = await db.insert(users).values({ email: `x-${suffix}@publyflow.test`, fullName: "X" }).returning();
  return { a, b, user };
}

// Runs `fn` inside a transaction restricted like the runtime tenant context:
// app.current_org_id set, then the non-bypass role publyflow_app.
async function inRestrictedTx<T>(db: Db, organizationId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org_id', ${organizationId}, true)`);
    await tx.execute(sql`set local role publyflow_app`);
    return fn(tx as unknown as Db);
  });
}

describe("SECURITY DEFINER cross-organization lookups", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("publyflow_user_memberships returns memberships of every organization inside a restricted transaction", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { a, b, user } = await seedTwoOrgsAndUser(db);
    const loggedAt = new Date("2026-10-01T12:00:00Z");
    await db.insert(organizationMembers).values([
      { organizationId: a.id, userId: user.id, role: "CREATOR" },
      { organizationId: b.id, userId: user.id, role: "MANAGER", firstLoginAt: loggedAt },
    ]);

    const { viaFunction, plainCount } = await inRestrictedTx(db, a.id, async (tx) => {
      const fn = await tx.execute<{ organization_id: string; role: string; first_login_at: Date | string | null }>(
        sql`select * from publyflow_user_memberships(${user.id}) order by role`,
      );
      const plain = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from organization_members where user_id = ${user.id}`,
      );
      return { viaFunction: fn.rows, plainCount: plain.rows[0].n };
    });

    expect(viaFunction).toHaveLength(2);
    const inA = viaFunction.find((r) => r.organization_id === a.id)!;
    const inB = viaFunction.find((r) => r.organization_id === b.id)!;
    expect(inA.role).toBe("CREATOR");
    expect(inA.first_login_at).toBeNull();
    expect(inB.role).toBe("MANAGER");
    expect(new Date(inB.first_login_at as string).toISOString()).toBe(loggedAt.toISOString());
    // A plain select under the restricted role only sees org A: the function is what crosses orgs.
    expect(plainCount).toBe(1);
  });

  it("publyflow_user_is_creator_elsewhere is true only when the user is a creator in another organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { a, b, user } = await seedTwoOrgsAndUser(db);

    const check = (orgId: string) =>
      inRestrictedTx(db, orgId, async (tx) => {
        const res = await tx.execute<{ v: boolean }>(sql`select publyflow_user_is_creator_elsewhere(${user.id}, ${orgId}) as v`);
        return res.rows[0].v;
      });

    expect(await check(a.id)).toBe(false);

    await db.insert(creators).values({ organizationId: b.id, userId: user.id, displayName: "X" });
    expect(await check(a.id)).toBe(true);
    expect(await check(b.id)).toBe(false);
  });

  it("EXECUTE is not granted to PUBLIC", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { a, user } = await seedTwoOrgsAndUser(db);
    const appDb = getAppUserDb();

    const causeOf = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error: { cause?: { message?: string } }) => error.cause?.message ?? null,
      );
    expect(await causeOf(appDb.execute(sql`select * from publyflow_user_memberships(${user.id})`))).toMatch(
      /permission denied for function publyflow_user_memberships/,
    );
    expect(
      await causeOf(appDb.execute(sql`select publyflow_user_is_creator_elsewhere(${user.id}, ${a.id})`)),
    ).toMatch(/permission denied for function publyflow_user_is_creator_elsewhere/);
  });
  it("repository lookups cross organizations inside a restricted transaction", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { a, b, user } = await seedTwoOrgsAndUser(db);
    await db.insert(organizationMembers).values([
      { organizationId: a.id, userId: user.id, role: "CREATOR" },
      { organizationId: b.id, userId: user.id, role: "OWNER" },
    ]);
    await db.insert(creators).values({ organizationId: b.id, userId: user.id, displayName: "X" });

    const { memberships, elsewhere } = await inRestrictedTx(db, a.id, async (tx) => ({
      memberships: await OrganizationMembersRepository.listAllForUserWithTx(tx, user.id),
      elsewhere: await CreatorsRepository.existsForUserOutsideOrganizationWithTx(tx, user.id, a.id),
    }));

    expect(memberships.map((m) => [m.organizationId, m.role]).sort()).toEqual(
      [
        [a.id, "CREATOR"],
        [b.id, "OWNER"],
      ].sort(),
    );
    expect(memberships.every((m) => m.firstLoginAt === null)).toBe(true);
    expect(elsewhere).toBe(true);
  });
});

// anon/authenticated/service_role exist only on Supabase; locally they are absent, so skip missing ones.
describe("function EXECUTE grants are not exposed to Supabase API roles", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("anon/authenticated/service_role cannot execute the SECURITY DEFINER functions", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const res = await db.execute(sql`select rolname from pg_roles where rolname in ('anon','authenticated','service_role')`);
    for (const { rolname } of res.rows as { rolname: string }[]) {
      for (const fn of ["publyflow_user_memberships(uuid)", "publyflow_user_is_creator_elsewhere(uuid, uuid)"]) {
        const r = await db.execute(sql`select has_function_privilege(${rolname}, ${fn}, 'EXECUTE') as ok`);
        expect((r.rows[0] as { ok: boolean }).ok, `${rolname} can execute ${fn}`).toBe(false);
      }
    }
  });
});
