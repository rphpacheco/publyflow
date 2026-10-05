import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { companies } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "@/repositories/tenant-context";
import { CompanyAliasesRepository } from "./company-aliases.repository";

describe("CompanyAliasesRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const orgId = a.organization.id;
    const companyId = a.opportunity.companyId!;
    const [other] = await db.insert(companies).values({ organizationId: orgId, name: "Outra Empresa" }).returning();
    const b = await seedProposal(db);
    return { db, orgId, companyId, otherId: other.id, orgB: b.organization.id, companyB: b.opportunity.companyId! };
  }

  it("inserts an alias once and ignores case/space variants", async () => {
    const { db, orgId, companyId } = await setup();
    const result = await runInTenantContext(db, orgId, async (tx) => {
      const first = await CompanyAliasesRepository.insertIfAbsentWithTx(tx, orgId, companyId, "  Bella  ");
      const second = await CompanyAliasesRepository.insertIfAbsentWithTx(tx, orgId, companyId, "BELLA");
      const list = await CompanyAliasesRepository.listByCompanyWithTx(tx, orgId, companyId);
      return { first, second, list };
    });
    expect(result.first).toBe(true);
    expect(result.second).toBe(false);
    expect(result.list.map((x) => x.name)).toEqual(["Bella"]);
  });

  it("finds the owner of an alias case/space-insensitively", async () => {
    const { db, orgId, companyId } = await setup();
    const found = await runInTenantContext(db, orgId, async (tx) => {
      await CompanyAliasesRepository.insertIfAbsentWithTx(tx, orgId, companyId, "Bella");
      return CompanyAliasesRepository.findOwnerCiWithTx(tx, orgId, " BELLA ");
    });
    expect(found).toMatchObject({ companyId, name: "Bella" });
  });

  it("moves all aliases of a company to another", async () => {
    const { db, orgId, companyId, otherId } = await setup();
    const result = await runInTenantContext(db, orgId, async (tx) => {
      await CompanyAliasesRepository.insertIfAbsentWithTx(tx, orgId, companyId, "A1");
      await CompanyAliasesRepository.insertIfAbsentWithTx(tx, orgId, companyId, "A2");
      const moved = await CompanyAliasesRepository.moveWithTx(tx, orgId, companyId, otherId);
      const from = await CompanyAliasesRepository.listByCompanyWithTx(tx, orgId, companyId);
      const to = await CompanyAliasesRepository.listByCompanyWithTx(tx, orgId, otherId);
      return { moved, from, to };
    });
    expect(result.moved).toBe(2);
    expect(result.from).toEqual([]);
    expect(result.to.map((x) => x.name)).toEqual(["A1", "A2"]);
  });

  it("deleteWithTx is false for another company's alias id and true for its own", async () => {
    const { db, orgId, companyId, otherId } = await setup();
    const result = await runInTenantContext(db, orgId, async (tx) => {
      await CompanyAliasesRepository.insertIfAbsentWithTx(tx, orgId, companyId, "A1");
      const [alias] = await CompanyAliasesRepository.listByCompanyWithTx(tx, orgId, companyId);
      const wrong = await CompanyAliasesRepository.deleteWithTx(tx, orgId, otherId, alias.id);
      const right = await CompanyAliasesRepository.deleteWithTx(tx, orgId, companyId, alias.id);
      return { wrong, right };
    });
    expect(result).toEqual({ wrong: false, right: true });
  });

  it("deleteByIdWithTx removes the alias", async () => {
    const { db, orgId, companyId } = await setup();
    const list = await runInTenantContext(db, orgId, async (tx) => {
      await CompanyAliasesRepository.insertIfAbsentWithTx(tx, orgId, companyId, "A1");
      const [alias] = await CompanyAliasesRepository.listByCompanyWithTx(tx, orgId, companyId);
      await CompanyAliasesRepository.deleteByIdWithTx(tx, orgId, alias.id);
      return CompanyAliasesRepository.listByCompanyWithTx(tx, orgId, companyId);
    });
    expect(list).toEqual([]);
  });

  it("isolates organizations", async () => {
    const { db, orgId, orgB, companyB } = await setup();
    await runInTenantContext(db, orgB, (tx) => CompanyAliasesRepository.insertIfAbsentWithTx(tx, orgB, companyB, "Bella"));
    const found = await runInTenantContext(db, orgId, (tx) => CompanyAliasesRepository.findOwnerCiWithTx(tx, orgId, "Bella"));
    expect(found).toBeNull();
  });
});
