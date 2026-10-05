import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { companyAliases } from "./schema/companies-brands-contacts";

describe("RLS on company_aliases", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns rows of the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    for (const s of [a, b]) {
      await db.insert(companyAliases).values({ organizationId: s.organization.id, companyId: s.opportunity.companyId!, name: "Bella" });
    }
    const rows = await getAppUserDb().transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${a.organization.id}, true)`);
      return tx.select().from(companyAliases);
    });
    expect(rows.map((r) => r.organizationId)).toEqual([a.organization.id]);
  });

  it("rejects a duplicate alias in the same org regardless of case/spaces", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const companyId = a.opportunity.companyId!;
    await db.insert(companyAliases).values({ organizationId: a.organization.id, companyId, name: "Bella" });
    await expect(db.insert(companyAliases).values({ organizationId: a.organization.id, companyId, name: "  bella " })).rejects.toThrow();
  });
});
