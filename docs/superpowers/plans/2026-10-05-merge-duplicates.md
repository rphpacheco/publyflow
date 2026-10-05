# Merge Duplicates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OWNER/MANAGER can merge a duplicate company into another (with the duplicate's name kept as an alias that inbox conversion recognizes) and a duplicate contact into another, from the duplicate's detail page, with a preview and no undo.

**Architecture:** New `company_aliases` table (migration 0023). `CompanyAliasesRepository` holds alias reads/writes; `CompaniesRepository.listByName` (used by inbox conversion) also matches aliases; `CrmService.updateCompany` refuses another company's alias and drops its own alias on rename. `CrmMergeService` runs each merge in one tenant transaction (lock both rows in id order → re-point references → fill blanks/aliases → delete duplicate → append domain event) and computes previews with the same queries. Routes map domain errors through `src/app/api/crm-errors.ts`. UI: "Mesclar em…" dialogs and an aliases block.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query, Drizzle + Postgres, zod 4, lucide-react, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-05-merge-duplicates-design.md`

## Global Constraints

- Every query and join carries an explicit `organization_id` predicate inside `runInTenantContext`. **Never `Promise.all` inside one `runInTenantContext`** (one tx = one pg connection) — use sequential awaits.
- Access: session (401) → `isUuid(id)` (route's 404) → `canManageOrganization(session.role)` (CREATOR → 403) → zod (400 `{ errors: z.flattenError(err).fieldErrors }`). Never raw exception text. 40P01 → 409 via `crmErrorResponse`.
- Messages (verbatim): "Empresa não encontrada." · "Contato não encontrado." · "Apelido não encontrado." · 422 `SAME_RECORD` "Escolha outra empresa." / "Escolha outro contato." · 409 `COMPANY_NAME_TAKEN` "Já existe uma empresa com esse nome." · 400 "Escolha a empresa que fica." / "Escolha o contato que fica."
- Names compared case-insensitively and trimmed: `lower(trim(x))`.
- UI: Portuguese copy exactly as specified; **no emoji or symbol glyphs** — icons only from lucide-react (`Merge`, `TriangleAlert`, `X`); no content may overflow its container at 320–1920px (use `min-w-0`, wrapping).
- Tests: `/opt/homebrew/bin/pnpm vitest run <files> --testTimeout=60000 --hookTimeout=60000`; never two vitest processes; never the full suite from the repo root while a worktree exists (use `--dir src`). Subagents never run `drizzle-kit migrate`, docker, or touch dev/prod databases (generating a migration file with `drizzle-kit generate` is allowed). The controller applies 0023 to the test DB before Task 2.
- Commit after each task; message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
|---|---|
| `src/db/schema/companies-brands-contacts.ts` (modify) | `companyAliases` table |
| `src/db/migrations/0023_add_company_aliases.sql` (+ meta) | table, unique index, RLS |
| `src/test/helpers/db.ts` (modify) | `company_aliases` in `DOMAIN_TABLES` |
| `src/db/rls-company-aliases.test.ts` | RLS test |
| `src/repositories/company-aliases.repository.ts` | alias reads/writes |
| `src/repositories/companies.repository.ts` (modify) | `listByName` matches aliases |
| `src/services/crm.service.ts` (modify) | rename vs aliases; `removeCompanyAlias` |
| `src/repositories/crm-read.repository.ts` (modify) | company detail includes aliases |
| `src/domain/crm/errors.ts` (modify) | `MergeSameRecordError`, `CompanyAliasNotFoundError` |
| `src/services/crm-merge.service.ts` | merge + preview |
| `src/app/api/crm-errors.ts` (modify) | new mappings |
| `src/app/api/companies/[id]/merge-preview/route.ts`, `merge/route.ts`, `aliases/[aliasId]/route.ts`, `src/app/api/contacts/[id]/merge-preview/route.ts`, `merge/route.ts` | HTTP |
| `src/hooks/use-crm-merge.ts`, `src/hooks/use-crm.ts` (modify) | hooks |
| `src/components/crm/merge-company-dialog.tsx`, `merge-contact-dialog.tsx`, `company-aliases.tsx` | UI |
| `src/app/(app)/companies/[id]/page.tsx`, `src/app/(app)/contacts/[id]/page.tsx` (modify) | wiring |

---

### Task 1: `company_aliases` table, migration 0023, RLS

**Files:**
- Modify: `src/db/schema/companies-brands-contacts.ts`, `src/test/helpers/db.ts`
- Create (generated + hand-appended RLS): `src/db/migrations/0023_add_company_aliases.sql` + meta snapshot/journal
- Test: `src/db/rls-company-aliases.test.ts`, extend `src/db/schema/companies-brands-contacts.test.ts` (if present) with an insert/unique case

**Interfaces (Produces):**
```ts
export const companyAliases: PgTable // columns: id, organizationId, companyId, name, createdAt
```

- [ ] **Step 1: Schema** — append to `src/db/schema/companies-brands-contacts.ts` (add `uniqueIndex` and `sql` imports):
```ts
export const companyAliases = pgTable(
  "company_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("company_aliases_org_name_unique").on(table.organizationId, sql`lower(trim(${table.name}))`)],
);
```
- [ ] **Step 2: Generate** `/opt/homebrew/bin/pnpm drizzle-kit generate --name add_company_aliases` and append to the generated SQL (same form as 0021):
```sql
--> statement-breakpoint
alter table company_aliases enable row level security;
--> statement-breakpoint
create policy org_isolation_company_aliases on company_aliases
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
```
Check the generated SQL contains only the new table, its FKs and the unique index (no unrelated changes). Journal idx 23.
- [ ] **Step 3:** Add `"company_aliases"` to `DOMAIN_TABLES` in `src/test/helpers/db.ts` **before** `"companies"` (FK order).
- [ ] **Step 4: RLS test** `src/db/rls-company-aliases.test.ts` (pattern of `src/db/rls-domain-events.test.ts`):
```ts
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
```
- [ ] **Step 5:** STOP before running the test: report to the controller that 0023 must be applied to the test DB (the controller runs `drizzle-kit migrate` on `publyflow_test`). Only after the controller confirms, run `pnpm vitest run src/db/rls-company-aliases.test.ts --testTimeout=60000 --hookTimeout=60000` and commit:
```bash
git add src/db src/test/helpers/db.ts
git commit -m "feat(db): company_aliases table with RLS (migration 0023)"
```

---

### Task 2: Alias rules — repository, conversion lookup, rename, detail, removal

**Files:**
- Create: `src/repositories/company-aliases.repository.ts`
- Modify: `src/repositories/companies.repository.ts` (`listByName`), `src/services/crm.service.ts` (`updateCompany`, new `removeCompanyAlias`), `src/repositories/crm-read.repository.ts` (`CompanyDetail.aliases`), `src/domain/crm/errors.ts` (`CompanyAliasNotFoundError`)
- Test: `src/repositories/company-aliases.repository.test.ts`, extend `src/services/crm.service.test.ts`, extend `src/services/commercial-inquiry.service.test.ts` (or the existing conversion test file — find it with `grep -l "resolve(" src/services/*commercial-inquiry*test*`), extend `src/repositories/crm-read.repository.test.ts`

**Interfaces (Produces):**
```ts
export type CompanyAlias = typeof companyAliases.$inferSelect;
export const CompanyAliasesRepository: {
  listByCompanyWithTx(tx, orgId, companyId): Promise<CompanyAlias[]>;                 // ordered by name
  findOwnerCiWithTx(tx, orgId, name): Promise<CompanyAlias | null>;                   // alias whose lower(trim(name)) matches
  insertIfAbsentWithTx(tx, orgId, companyId, name): Promise<boolean>;                // ON CONFLICT DO NOTHING; true if inserted
  moveWithTx(tx, orgId, fromCompanyId, toCompanyId): Promise<number>;
  deleteWithTx(tx, orgId, companyId, aliasId): Promise<boolean>;
  deleteByIdWithTx(tx, orgId, aliasId): Promise<void>;
};
export class CompanyAliasNotFoundError extends Error { constructor(aliasId: string) }
CrmService.removeCompanyAlias(db, orgId, companyId, aliasId): Promise<void>   // CompanyAliasNotFoundError
CompanyDetail.aliases: Array<{ id: string; name: string }>
```

- [ ] **Step 1: Write failing tests**
  - `company-aliases.repository.test.ts`: `insertIfAbsentWithTx` inserts then returns false on a case/space variant; `findOwnerCiWithTx(" BELLA ")` finds it; `moveWithTx` moves all aliases of a company; `deleteWithTx` returns false for another company's alias id and true for its own; org isolation (alias of org B not found from org A).
  - `crm.service.test.ts`: `updateCompany` refuses a name equal to **another** company's alias (`CompanyNameTakenError`); renaming to its **own** alias succeeds and removes that alias; `removeCompanyAlias` removes it and throws `CompanyAliasNotFoundError` for an unknown or other company's alias.
  - conversion test: an inquiry whose `companyGuess` is " bella " (alias of "Bella Cosméticos") converts into the existing company (no new company created); a guess matching the name of company X and an alias of company Y → `AmbiguousPartyGuessError`.
  - `crm-read.repository.test.ts`: `companyDetail(...).aliases` lists `{ id, name }` ordered by name.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**

`src/repositories/company-aliases.repository.ts`:
```ts
import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { companyAliases } from "@/db/schema/companies-brands-contacts";

type Db = NodePgDatabase<typeof schema>;
export type CompanyAlias = typeof companyAliases.$inferSelect;

const sameName = (name: string) => sql`lower(trim(${companyAliases.name})) = lower(trim(${name}))`;

export const CompanyAliasesRepository = {
  listByCompanyWithTx(tx: Db, organizationId: string, companyId: string): Promise<CompanyAlias[]> {
    return tx.select().from(companyAliases)
      .where(and(eq(companyAliases.organizationId, organizationId), eq(companyAliases.companyId, companyId)))
      .orderBy(asc(companyAliases.name));
  },

  async findOwnerCiWithTx(tx: Db, organizationId: string, name: string): Promise<CompanyAlias | null> {
    const [row] = await tx.select().from(companyAliases)
      .where(and(eq(companyAliases.organizationId, organizationId), sameName(name))).limit(1);
    return row ?? null;
  },

  async insertIfAbsentWithTx(tx: Db, organizationId: string, companyId: string, name: string): Promise<boolean> {
    const rows = await tx.insert(companyAliases).values({ organizationId, companyId, name: name.trim() })
      .onConflictDoNothing().returning({ id: companyAliases.id });
    return rows.length > 0;
  },

  async moveWithTx(tx: Db, organizationId: string, fromCompanyId: string, toCompanyId: string): Promise<number> {
    const rows = await tx.update(companyAliases).set({ companyId: toCompanyId })
      .where(and(eq(companyAliases.organizationId, organizationId), eq(companyAliases.companyId, fromCompanyId)))
      .returning({ id: companyAliases.id });
    return rows.length;
  },

  async deleteWithTx(tx: Db, organizationId: string, companyId: string, aliasId: string): Promise<boolean> {
    const rows = await tx.delete(companyAliases)
      .where(and(eq(companyAliases.organizationId, organizationId), eq(companyAliases.companyId, companyId), eq(companyAliases.id, aliasId)))
      .returning({ id: companyAliases.id });
    return rows.length > 0;
  },

  async deleteByIdWithTx(tx: Db, organizationId: string, aliasId: string): Promise<void> {
    await tx.delete(companyAliases).where(and(eq(companyAliases.organizationId, organizationId), eq(companyAliases.id, aliasId)));
  },
};
```
(If drizzle's `onConflictDoNothing()` without a target does not work with the expression index, use `onConflictDoNothing()` anyway — Postgres `ON CONFLICT DO NOTHING` without a target covers any unique violation.)

`CompaniesRepository.listByName` (inbox conversion lookup; keep the signature):
```ts
  // Exact name (existing behavior) OR an alias equal to the guess (case/space-insensitive), deduplicated.
  async listByName(db, organizationId, name): Promise<Company[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const byName = await tx.select().from(companies)
        .where(and(eq(companies.name, name), eq(companies.organizationId, organizationId)));
      const byAlias = await tx.select({ company: companies }).from(companyAliases)
        .innerJoin(companies, and(eq(companies.id, companyAliases.companyId), eq(companies.organizationId, organizationId)))
        .where(and(eq(companyAliases.organizationId, organizationId), sql`lower(trim(${companyAliases.name})) = lower(trim(${name}))`));
      const result = new Map(byName.map((c) => [c.id, c]));
      for (const row of byAlias) result.set(row.company.id, row.company);
      return [...result.values()];
    });
  },
```

`CrmService.updateCompany` — after the existing name check:
```ts
      const alias = await CompanyAliasesRepository.findOwnerCiWithTx(tx, organizationId, input.name);
      if (alias && alias.companyId !== companyId) throw new CompanyNameTakenError(input.name);
      const updated = await CompaniesRepository.updateNameWithTx(tx, organizationId, companyId, input.name);
      if (alias) await CompanyAliasesRepository.deleteByIdWithTx(tx, organizationId, alias.id); // renamed to its own alias
      return updated;
```
New:
```ts
  async removeCompanyAlias(db: Db, organizationId: string, companyId: string, aliasId: string): Promise<void> {
    await runInTenantContext(db, organizationId, async (tx) => {
      const removed = await CompanyAliasesRepository.deleteWithTx(tx, organizationId, companyId, aliasId);
      if (!removed) throw new CompanyAliasNotFoundError(aliasId);
    });
  },
```
`CompanyAliasNotFoundError` in `src/domain/crm/errors.ts` (pattern of the other classes, message `Company alias ${aliasId} not found`). `CrmReadRepository.companyDetail` adds `aliases: Array<{ id: string; name: string }>` (select `id, name` from `company_aliases` where org + company, ordered by name) to `CompanyDetail`.
- [ ] **Step 4: Run — expect PASS** (the four test files).
- [ ] **Step 5: Commit** `feat(crm): company aliases — conversion lookup, rename rule, removal, detail`.

---

### Task 3: `CrmMergeService` (merge + preview)

**Files:**
- Create: `src/services/crm-merge.service.ts`
- Modify: `src/domain/crm/errors.ts` (`MergeSameRecordError`)
- Test: `src/services/crm-merge.service.test.ts`

**Interfaces:**
- Consumes: Task 2 repository; `CompaniesRepository.lockByIdWithTx`; `ContactsRepository.findByIdWithTx`; `DomainEventsRepository.appendWithTx(tx, orgId, { eventType, entityType, entityId, payload, actor })`.
- Produces:
```ts
export class MergeSameRecordError extends Error { constructor(kind: "company" | "contact") ; readonly kind }
export interface CompanyMergePreview { duplicate: { id: string; name: string }; stays: { id: string; name: string }; result: { name: string }; impact: { brands: number; contacts: number; leads: number; opportunities: number }; aliasToAdd: string | null; aliasesMoved: number }
export interface ContactMergePreview { duplicate: { id: string; name: string }; stays: { id: string; name: string }; result: { fullName: string; email: string | null; phone: string | null; instagramHandle: string | null; company: { id: string; name: string } | null }; filledFromDuplicate: Array<"email" | "phone" | "instagramHandle" | "companyId">; impact: { leads: number } }
export const CrmMergeService: {
  previewCompanyMerge(db, orgId, duplicateId, staysId): Promise<CompanyMergePreview>;
  mergeCompany(db, orgId, duplicateId, staysId, actor: { userId: string }): Promise<Company>;
  previewContactMerge(db, orgId, duplicateId, staysId): Promise<ContactMergePreview>;
  mergeContact(db, orgId, duplicateId, staysId, actor: { userId: string }): Promise<Contact>;
};
```

- [ ] **Step 1: Write failing tests** `src/services/crm-merge.service.test.ts` (seed with `seedProposal` + direct inserts of companies/brands/contacts/leads/opportunities/aliases; one `it` per case, exact assertions):
  1. Company merge moves brands, contacts, leads and opportunities from duplicate to stays (query each table by the moved ids → `company_id = stays`), deletes the duplicate, returns stays.
  2. The duplicate's name becomes an alias of stays; not added when equal (case/space) to stays' name; the duplicate's existing aliases move to stays, except one equal to stays' name (deleted).
  3. A `company.merged` domain event exists with `entityId = stays`, `payload.duplicateName`, `payload.moved.*Ids` exactly the moved ids, `actor.userId`.
  4. `previewCompanyMerge` counts equal the ids moved by `mergeCompany` on the same data; `aliasToAdd` and `aliasesMoved` correct; calling preview twice changes nothing (row counts identical before/after).
  5. Same id → `MergeSameRecordError`; stays or duplicate from another org → `CompanyNotFoundError`; org B rows untouched after an org A merge.
  6. Atomicity: `vi.spyOn(DomainEventsRepository, "appendWithTx").mockRejectedValueOnce(new Error("boom"))` → `mergeCompany` rejects, the duplicate still exists and no reference moved, no alias added.
  7. Contact merge moves leads, fills only empty fields of stays (stays has email, no phone; duplicate has both → phone filled, email kept), deletes duplicate, `contact.merged` event with `filledFields`.
  8. `previewContactMerge` returns the final fields, `filledFromDuplicate`, `impact.leads`, writes nothing; same-record and other-org errors.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `src/services/crm-merge.service.ts`:
```ts
import { and, count, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { brands, companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "@/repositories/tenant-context";
import { CompaniesRepository, type Company } from "@/repositories/companies.repository";
import { ContactsRepository, type Contact } from "@/repositories/contacts.repository";
import { CompanyAliasesRepository } from "@/repositories/company-aliases.repository";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { CompanyNotFoundError, ContactNotFoundError, MergeSameRecordError } from "@/domain/crm/errors";

type Db = NodePgDatabase<typeof schema>;
const norm = (s: string) => s.trim().toLowerCase();

// Lock both rows in ascending id order so two merges of the same pair never deadlock.
async function lockCompanies(tx: Db, organizationId: string, duplicateId: string, staysId: string) {
  if (duplicateId === staysId) throw new MergeSameRecordError("company");
  const [first, second] = [duplicateId, staysId].sort();
  const a = await CompaniesRepository.lockByIdWithTx(tx, organizationId, first);
  const b = await CompaniesRepository.lockByIdWithTx(tx, organizationId, second);
  const duplicate = [a, b].find((c) => c?.id === duplicateId);
  const stays = [a, b].find((c) => c?.id === staysId);
  if (!duplicate) throw new CompanyNotFoundError(duplicateId);
  if (!stays) throw new CompanyNotFoundError(staysId);
  return { duplicate, stays };
}

async function countWhere(tx: Db, table: typeof brands | typeof contacts | typeof leads | typeof opportunities, organizationId: string, companyId: string) {
  const [row] = await tx.select({ n: count() }).from(table)
    .where(and(eq(table.organizationId, organizationId), eq(table.companyId, companyId)));
  return Number(row.n);
}

async function companyImpact(tx: Db, organizationId: string, duplicate: Company, stays: Company) {
  const aliases = await CompanyAliasesRepository.listByCompanyWithTx(tx, organizationId, duplicate.id);
  const staysAliases = await CompanyAliasesRepository.listByCompanyWithTx(tx, organizationId, stays.id);
  const nameIsNew = norm(duplicate.name) !== norm(stays.name) && !staysAliases.some((a) => norm(a.name) === norm(duplicate.name));
  return {
    impact: {
      brands: await countWhere(tx, brands, organizationId, duplicate.id),
      contacts: await countWhere(tx, contacts, organizationId, duplicate.id),
      leads: await countWhere(tx, leads, organizationId, duplicate.id),
      opportunities: await countWhere(tx, opportunities, organizationId, duplicate.id),
    },
    aliasToAdd: nameIsNew ? duplicate.name : null,
    aliasesMoved: aliases.filter((a) => norm(a.name) !== norm(stays.name)).length,
    aliases,
  };
}

async function repoint(tx: Db, table: typeof brands | typeof contacts | typeof leads | typeof opportunities, organizationId: string, fromId: string, toId: string) {
  const rows = await tx.update(table).set({ companyId: toId })
    .where(and(eq(table.organizationId, organizationId), eq(table.companyId, fromId)))
    .returning({ id: table.id });
  return rows.map((r) => r.id);
}

const CONTACT_FILLABLE = ["email", "phone", "instagramHandle", "companyId"] as const;
type Fillable = (typeof CONTACT_FILLABLE)[number];

async function lockContacts(tx: Db, organizationId: string, duplicateId: string, staysId: string) {
  if (duplicateId === staysId) throw new MergeSameRecordError("contact");
  const [first, second] = [duplicateId, staysId].sort();
  const lock = (id: string) =>
    tx.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.organizationId, organizationId))).for("update");
  const [a] = await lock(first);
  const [b] = await lock(second);
  const duplicate = [a, b].find((c) => c?.id === duplicateId);
  const stays = [a, b].find((c) => c?.id === staysId);
  if (!duplicate) throw new ContactNotFoundError(duplicateId);
  if (!stays) throw new ContactNotFoundError(staysId);
  return { duplicate, stays };
}

function filledFields(duplicate: Contact, stays: Contact): Fillable[] {
  return CONTACT_FILLABLE.filter((f) => (stays[f] === null || stays[f] === "") && duplicate[f] !== null && duplicate[f] !== "");
}

export const CrmMergeService = {
  async previewCompanyMerge(db: Db, organizationId: string, duplicateId: string, staysId: string) {
    return runInTenantContext(db, organizationId, async (tx) => {
      const { duplicate, stays } = await lockCompanies(tx, organizationId, duplicateId, staysId);
      const { impact, aliasToAdd, aliasesMoved } = await companyImpact(tx, organizationId, duplicate, stays);
      return {
        duplicate: { id: duplicate.id, name: duplicate.name },
        stays: { id: stays.id, name: stays.name },
        result: { name: stays.name },
        impact,
        aliasToAdd,
        aliasesMoved,
      };
    });
  },

  async mergeCompany(db: Db, organizationId: string, duplicateId: string, staysId: string, actor: { userId: string }): Promise<Company> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const { duplicate, stays } = await lockCompanies(tx, organizationId, duplicateId, staysId);
      const { aliasToAdd, aliases } = await companyImpact(tx, organizationId, duplicate, stays);
      const moved = {
        brandIds: await repoint(tx, brands, organizationId, duplicate.id, stays.id),
        contactIds: await repoint(tx, contacts, organizationId, duplicate.id, stays.id),
        leadIds: await repoint(tx, leads, organizationId, duplicate.id, stays.id),
        opportunityIds: await repoint(tx, opportunities, organizationId, duplicate.id, stays.id),
      };
      for (const alias of aliases) {
        if (norm(alias.name) === norm(stays.name)) await CompanyAliasesRepository.deleteByIdWithTx(tx, organizationId, alias.id);
      }
      await CompanyAliasesRepository.moveWithTx(tx, organizationId, duplicate.id, stays.id);
      // Delete first so the duplicate's own name is free before it becomes an alias.
      await tx.delete(companies).where(and(eq(companies.id, duplicate.id), eq(companies.organizationId, organizationId)));
      const aliasesAdded: string[] = [];
      if (aliasToAdd && (await CompanyAliasesRepository.insertIfAbsentWithTx(tx, organizationId, stays.id, aliasToAdd))) {
        aliasesAdded.push(aliasToAdd);
      }
      await DomainEventsRepository.appendWithTx(tx, organizationId, {
        eventType: "company.merged",
        entityType: "company",
        entityId: stays.id,
        payload: { duplicateId: duplicate.id, duplicateName: duplicate.name, staysId: stays.id, moved, aliasesAdded },
        actor: { userId: actor.userId },
      });
      return stays;
    });
  },

  async previewContactMerge(db: Db, organizationId: string, duplicateId: string, staysId: string) {
    return runInTenantContext(db, organizationId, async (tx) => {
      const { duplicate, stays } = await lockContacts(tx, organizationId, duplicateId, staysId);
      const fill = filledFields(duplicate, stays);
      const merged = { ...stays, ...Object.fromEntries(fill.map((f) => [f, duplicate[f]])) } as Contact;
      let company: { id: string; name: string } | null = null;
      if (merged.companyId) {
        const found = await CompaniesRepository.findByIdWithTx(tx, organizationId, merged.companyId);
        company = found ? { id: found.id, name: found.name } : null;
      }
      const [row] = await tx.select({ n: count() }).from(leads)
        .where(and(eq(leads.organizationId, organizationId), eq(leads.contactId, duplicate.id)));
      return {
        duplicate: { id: duplicate.id, name: duplicate.fullName },
        stays: { id: stays.id, name: stays.fullName },
        result: { fullName: stays.fullName, email: merged.email, phone: merged.phone, instagramHandle: merged.instagramHandle, company },
        filledFromDuplicate: fill,
        impact: { leads: Number(row.n) },
      };
    });
  },

  async mergeContact(db: Db, organizationId: string, duplicateId: string, staysId: string, actor: { userId: string }): Promise<Contact> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const { duplicate, stays } = await lockContacts(tx, organizationId, duplicateId, staysId);
      const fill = filledFields(duplicate, stays);
      const leadIds = (await tx.update(leads).set({ contactId: stays.id })
        .where(and(eq(leads.organizationId, organizationId), eq(leads.contactId, duplicate.id)))
        .returning({ id: leads.id })).map((r) => r.id);
      let updated = stays;
      if (fill.length > 0) {
        [updated] = await tx.update(contacts).set(Object.fromEntries(fill.map((f) => [f, duplicate[f]])))
          .where(and(eq(contacts.id, stays.id), eq(contacts.organizationId, organizationId))).returning();
      }
      await tx.delete(contacts).where(and(eq(contacts.id, duplicate.id), eq(contacts.organizationId, organizationId)));
      await DomainEventsRepository.appendWithTx(tx, organizationId, {
        eventType: "contact.merged",
        entityType: "contact",
        entityId: stays.id,
        payload: { duplicateId: duplicate.id, duplicateName: duplicate.fullName, staysId: stays.id, moved: { leadIds }, filledFields: fill },
        actor: { userId: actor.userId },
      });
      return updated;
    });
  },
};
```
Notes: the preview also takes the `FOR UPDATE` locks (inside its own short transaction) — acceptable; it writes nothing. Remove the unused `sql` import if lint flags it. `MergeSameRecordError` in `src/domain/crm/errors.ts`:
```ts
export class MergeSameRecordError extends Error {
  constructor(readonly kind: "company" | "contact") {
    super(`Cannot merge a ${kind} into itself`);
    this.name = "MergeSameRecordError";
  }
}
```
- [ ] **Step 4: Run — expect PASS** `pnpm vitest run src/services/crm-merge.service.test.ts --testTimeout=60000 --hookTimeout=60000`.
- [ ] **Step 5: Commit** `feat(crm): merge companies/contacts service with preview`.

---

### Task 4: API routes + error mapping

**Files:**
- Modify: `src/app/api/crm-errors.ts`, `src/app/api/companies/[id]/route.test.ts` (aliases in detail), `src/app/api/id-guard.test.ts`
- Create: `src/lib/crm/merge-input.ts`, `src/app/api/companies/[id]/merge-preview/route.ts`, `src/app/api/companies/[id]/merge/route.ts`, `src/app/api/companies/[id]/aliases/[aliasId]/route.ts`, `src/app/api/contacts/[id]/merge-preview/route.ts`, `src/app/api/contacts/[id]/merge/route.ts` + a `route.test.ts` next to each

**Interfaces:**
- Consumes: Task 2/3 services and errors.
- Produces (HTTP): `GET …/merge-preview?into=` → preview DTO; `POST …/merge` `{ into }` → stays; `DELETE /api/companies/[id]/aliases/[aliasId]` → 204.

- [ ] **Step 1: Write failing tests** — for each route: 401 (no session), 403 (CREATOR), 404 malformed `[id]` and unknown id ("Empresa não encontrada." / "Contato não encontrado."), 400 missing `into` (`errors.into` = ["Escolha a empresa que fica."] / ["Escolha o contato que fica."]), 400 malformed `into` (same message), 404 unknown `into`, 422 same id (`{ error: "Escolha outra empresa.", code: "SAME_RECORD" }` / "Escolha outro contato."), 200 preview shape / 200 merge returns stays and the duplicate is gone. Alias DELETE: 204, then 404 "Apelido não encontrado." on repeat, 404 for another company's alias id. Add the new `[id]` routes to `id-guard.test.ts` (merge-preview GET, merge POST, aliases DELETE uses `[aliasId]` — add a case with both params malformed); `write-guard.test.ts` must pass (every POST/DELETE calls `canManageOrganization(`).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**

`src/lib/crm/merge-input.ts`:
```ts
import { z } from "zod";
import { isUuid } from "@/lib/uuid";

const intoField = (message: string) => z.string({ error: message }).refine(isUuid, message);
export const companyMergeSchema = z.object({ into: intoField("Escolha a empresa que fica.") });
export const contactMergeSchema = z.object({ into: intoField("Escolha o contato que fica.") });
```
`src/app/api/crm-errors.ts` — add before the deadlock branch:
```ts
  if (error instanceof MergeSameRecordError) {
    const message = error.kind === "company" ? "Escolha outra empresa." : "Escolha outro contato.";
    return NextResponse.json({ error: message, code: "SAME_RECORD" }, { status: 422 });
  }
  if (error instanceof CompanyAliasNotFoundError) return notFoundResponse("Apelido não encontrado.");
```
`src/app/api/companies/[id]/merge-preview/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { getSession } from "@/lib/auth/session";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";
import { isUuid } from "@/lib/uuid";
import { companyMergeSchema } from "@/lib/crm/merge-input";
import { CrmMergeService } from "@/services/crm-merge.service";
import { COMPANY_NOT_FOUND, crmErrorResponse, notFoundResponse } from "../../../crm-errors";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const { id } = await params;
  if (!isUuid(id)) return notFoundResponse(COMPANY_NOT_FOUND);
  if (!canManageOrganization(session.role)) return forbiddenResponse();
  const parsed = companyMergeSchema.safeParse({ into: new URL(request.url).searchParams.get("into") ?? undefined });
  if (!parsed.success) return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  try {
    return NextResponse.json(await CrmMergeService.previewCompanyMerge(db, session.organizationId, id, parsed.data.into));
  } catch (error) {
    const mapped = crmErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
```
`…/merge/route.ts`: same guards, `POST`, body `await request.json().catch(() => null)` parsed with the schema, `CrmMergeService.mergeCompany(db, orgId, id, into, { userId: session.userId })` → 200 JSON. Contacts routes mirror these with `CONTACT_NOT_FOUND`, `contactMergeSchema`, `previewContactMerge`/`mergeContact`. `aliases/[aliasId]/route.ts`: `DELETE`, guards (both ids `isUuid` → 404 "Apelido não encontrado." for a malformed alias id, `COMPANY_NOT_FOUND` for a malformed company id), `CrmService.removeCompanyAlias` → `new NextResponse(null, { status: 204 })`.
- [ ] **Step 4: Run — expect PASS** (new route tests + `src/app/api/companies src/app/api/contacts src/app/api/id-guard.test.ts src/app/api/write-guard.test.ts`).
- [ ] **Step 5: Commit** `feat(api): merge preview/merge routes for companies and contacts, alias removal`.

---

### Task 5: Hooks, dialogs, aliases block, page wiring

**Files:**
- Create: `src/hooks/use-crm-merge.ts`, `src/components/crm/merge-company-dialog.tsx`, `src/components/crm/merge-contact-dialog.tsx`, `src/components/crm/company-aliases.tsx` (+ tests for each)
- Modify: `src/hooks/use-crm.ts` (`CompanyDetailDto.aliases`), `src/app/(app)/companies/[id]/page.tsx`, `src/app/(app)/contacts/[id]/page.tsx` (+ their tests)

**Interfaces (Produces):**
```ts
useCompanyMergePreview(duplicateId: string, into: string | null)  // enabled only when into !== null; key ["crm","merge-preview","company",duplicateId,into]
useMergeCompany(duplicateId) → mutateAsync({ into }) : CompanyDto      // invalidates crmQueryKey + company/brand/contact option keys
useContactMergePreview(duplicateId, into) / useMergeContact(duplicateId)
useRemoveCompanyAlias(companyId) → mutateAsync({ aliasId })
<MergeCompanyDialog open company={{ id, name }} onOpenChange onMerged={(stays: CompanyDto) => void} />
<MergeContactDialog open contact={{ id, fullName }} onOpenChange onMerged={(stays: ContactDto) => void} />
<CompanyAliases companyId aliases={Array<{ id, name }>} />
```

- [ ] **Step 1: Write failing tests**
  - `merge-company-dialog.test.tsx` (mock `@/hooks/use-crm` `useCompanies` and `@/hooks/use-crm-merge`): the combobox excludes the current company; before choosing, "Mesclar" is disabled; with a preview it shows "Fica: …", "Vai mover: 2 brands · 3 contatos · 4 oportunidades", "'Bella' passa a ser apelido de 'Bella Cosméticos'", "1 apelido também será movido" (singular) / "2 apelidos também serão movidos", and the warning "Esta ação não pode ser desfeita. Bella será excluída." with an svg icon; clicking "Mesclar" calls `mutateAsync({ into })` and `onMerged`; a 422 `ApiError` shows "Escolha outra empresa." under the combobox; preview error shows "Não foi possível carregar a prévia" + "Tentar novamente" (calls refetch); no glyphs (`/[\p{Extended_Pictographic}←-⇿▲▼✓✔]/u`).
  - `merge-contact-dialog.test.tsx`: combobox labels "{nome} ({empresa})" or just the name when no company; preview lists Nome/E-mail/Telefone/Instagram/Empresa with "(do duplicado)" on the filled ones; "Vai mover: 1 lead" / "N leads"; warning "Esta ação não pode ser desfeita. {nome} será excluído."
  - `company-aliases.test.tsx`: renders nothing when empty; lists aliases with help text "Nomes que a IA do Inbox reconhece como esta empresa."; the remove button has aria-label "Remover apelido Bella"; after confirming, calls `mutateAsync({ aliasId })` and toasts "Apelido removido.".
  - page tests: company detail shows "Mesclar em…" (opens the dialog) and the aliases block; after `onMerged` → toast "Empresas mescladas." and `router.push("/companies/{stays.id}")`; contact detail → "Contatos mesclados." and `/contacts/{id}`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — follow the existing dialog pattern (`src/components/crm/company-form-dialog.tsx`, `Dialog*` from `@/components/ui/dialog`, `Combobox` from `@/components/ui/combobox`, `toFormErrors`-style error placement from `src/components/crm/form-errors.ts`; a 422 with `code: "SAME_RECORD"` goes under the combobox). Use lucide `Merge` on the "Mesclar em…" button, `TriangleAlert` in the warning box (`bg-error/10 text-error`), `X` on alias remove buttons; the destructive "Mesclar" button uses the project's destructive button variant (check `src/components/ui/button.tsx`). Pluralize with a small local helper (`1 brand`/`N brands`, `1 contato`/`N contatos`, `1 oportunidade`/`N oportunidades`, `1 lead`/`N leads`, `1 apelido também será movido`/`N apelidos também serão movidos`). Mount dialogs conditionally from the pages (their state initializes from props). Keep every text inside its container (`min-w-0`, wrapping). Hooks file pattern: `src/hooks/use-crm.ts`.
- [ ] **Step 4: Run — expect PASS**: `pnpm vitest run src/components/crm src/hooks companies/ contacts/` (substring filters; no DB).
- [ ] **Step 5: Commit** `feat(crm): merge dialogs, aliases block and page wiring`.

---

### Task 6: Verification (controller, not a subagent)

- [ ] `pnpm exec next typegen && pnpm tsc --noEmit`; `pnpm lint` (no new findings in touched files).
- [ ] 0023 on test DB (already before Task 1 Step 5) and on local dev DB.
- [ ] Full suite `pnpm vitest run --dir src --testTimeout=60000 --hookTimeout=60000`; build.
- [ ] Final whole-branch review (most capable model) + fix wave.
- [ ] Browser (user logs in if needed): merge two companies and two contacts, see the alias, post an inbox message whose company guess is the alias and convert it → lands on the remaining company; DOM overflow audit 320–1920px.
- [ ] Deploy (user's go-ahead): count nothing to migrate (schema-only), apply 0023 in production, push `main`, confirm the new route answers 401.
- [ ] Update `TAREFA.md`.
