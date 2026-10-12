import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { runInTenantContext } from "@/repositories/tenant-context";
import { companies } from "./schema/companies-brands-contacts";
import { opportunities } from "./schema/commercial-flow";
import { organizationMembers } from "./schema/organizations";

type Db = Awaited<ReturnType<typeof withTestDb>>["db"];

// Two organizations, each with an owner + creator membership, a company and an opportunity.
async function seedTwoOrgs(db: Db) {
  const a = await seedProposal(db);
  const b = await seedProposal(db);
  return { orgA: a.organization.id, orgB: b.organization.id };
}

function causeMessage(error: unknown): string {
  const e = error as { message?: string; cause?: { message?: string } };
  return e.cause?.message ?? e.message ?? "";
}

describe("runInTenantContext enforces RLS at runtime", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanup?.();
  });

  it("an unfiltered select only sees the tenant's companies, opportunities and memberships", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { orgA, orgB } = await seedTwoOrgs(db);

    // Sanity: the privileged connection sees both organizations.
    const all = await db.select().from(companies);
    expect(new Set(all.map((r) => r.organizationId))).toEqual(new Set([orgA, orgB]));

    const seen = await runInTenantContext(db, orgA, async (tx) => ({
      companies: await tx.select().from(companies),
      opportunities: await tx.select().from(opportunities),
      members: await tx.select().from(organizationMembers),
    }));

    expect(seen.companies.length).toBeGreaterThan(0);
    expect(seen.opportunities.length).toBeGreaterThan(0);
    expect(seen.members.length).toBeGreaterThan(0);
    expect(seen.companies.every((r) => r.organizationId === orgA)).toBe(true);
    expect(seen.opportunities.every((r) => r.organizationId === orgA)).toBe(true);
    expect(seen.members.every((r) => r.organizationId === orgA)).toBe(true);
  });

  it("rejects inserting a row for another organization (policy WITH CHECK)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { orgA, orgB } = await seedTwoOrgs(db);

    const error = await runInTenantContext(db, orgA, async (tx) => {
      await tx.insert(companies).values({ organizationId: orgB, name: "Intrusa" });
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).not.toBeNull();
    expect(causeMessage(error)).toMatch(/row-level security/);
    const intruders = await db.select().from(companies).where(sql`${companies.name} = 'Intrusa'`);
    expect(intruders).toHaveLength(0);
  });

  it("runs as publyflow_app", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { orgA } = await seedTwoOrgs(db);

    const user = await runInTenantContext(db, orgA, async (tx) => {
      const res = await tx.execute<{ u: string }>(sql`select current_user as u`);
      return res.rows[0].u;
    });
    expect(user).toBe("publyflow_app");
  });

  it("TENANT_RLS=off is the kill switch: privileged role, unfiltered select sees every organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { orgA, orgB } = await seedTwoOrgs(db);
    vi.stubEnv("TENANT_RLS", "off");

    const { rows, user } = await runInTenantContext(db, orgA, async (tx) => ({
      rows: await tx.select().from(companies),
      user: (await tx.execute<{ u: string }>(sql`select current_user as u`)).rows[0].u,
    }));

    expect(new Set(rows.map((r) => r.organizationId))).toEqual(new Set([orgA, orgB]));
    expect(user).not.toBe("publyflow_app");
  });
});
