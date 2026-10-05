# Companies & Contacts Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 404s at `/companies` and `/contacts` with list + detail pages where OWNER/MANAGER can read relations and edit company, contact and brand data.

**Architecture:** A read-model repository (`crm-read.repository.ts`) computes list counts and detail aggregates with explicit `organization_id` predicates; a `CrmService` owns the three edit flows (company rename with duplicate-name check under a row lock, contact/brand edit with company-ownership check). Route handlers map domain errors to Portuguese responses via one mapper. The UI follows the `/creators` pattern: TanStack Query hooks on `apiFetch`, project `Table`, form dialogs, `sonner` toasts.

**Tech Stack:** Next.js 16 App Router (client pages, `React.use(params)`), React 19, TanStack Query, Drizzle ORM + Postgres, zod 4, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-04-companies-contacts-design.md`

## Global Constraints

- Every query and every join carries an explicit `organization_id` predicate and runs inside `runInTenantContext` (the app role bypasses RLS).
- Access: OWNER/MANAGER only via `canManageOrganization(session.role)` → CREATOR gets 403. Pages redirect a creator to `/pipeline`.
- `[id]` routes: `isUuid(id)` first → malformed id returns the route's own 404 body.
- Error body: `{ error: "<pt-BR>", code?: "MACHINE_CODE" }`; validation: 400 `{ errors: z.flattenError(err).fieldErrors }`. Never send raw exception text.
- Messages (verbatim): "Empresa não encontrada." · "Contato não encontrado." · "Brand não encontrada." · 409 `COMPANY_NAME_TAKEN` "Já existe uma empresa com esse nome." · 422 `COMPANY_NOT_FOUND` "Empresa selecionada não encontrada." · max length "Use no máximo 200 caracteres." · at least one field "Informe ao menos um campo." (key `form`).
- Text fields trimmed, max 200; nullable fields: empty string after trim → `null`.
- No migration, no new dependency. No create/delete/merge.
- UI copy in Portuguese. Toasts: "Empresa atualizada." / "Contato atualizado." / "Brand atualizada."
- Tests: `pnpm vitest run <file> --testTimeout=60000 --hookTimeout=60000` (pnpm from `/opt/homebrew/bin`). **Never run two `vitest run` processes at once** (shared test DB on tmpfs). Subagents run tests only — they never run migrations, `docker compose`, or touch the dev/production databases.
- Commit after each task with a conventional-commit message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
|---|---|
| `src/domain/crm/errors.ts` (create) | Domain error classes |
| `src/lib/crm/crm-input.ts` (create) | zod schemas for the 3 PATCH bodies |
| `src/lib/crm/search.ts` (create) | accent/case-insensitive client search |
| `src/app/api/crm-errors.ts` (create) | domain error → HTTP response mapper + 404 helpers |
| `src/repositories/crm-read.repository.ts` (create) | list counts + detail aggregates |
| `src/repositories/{companies,contacts,brands}.repository.ts` (modify) | lock / name lookup / update methods |
| `src/services/crm.service.ts` (create) | read + edit use cases |
| `src/services/{company,contact}.service.ts` (delete) | superseded by `CrmService` |
| `src/app/api/companies/route.ts`, `companies/[id]/route.ts`, `contacts/route.ts`, `contacts/[id]/route.ts` (modify), `brands/[id]/route.ts` (create) | HTTP |
| `src/app/api/id-guard.test.ts` (modify) | new 404 bodies + PATCH cases |
| `src/hooks/use-crm.ts` (create) | queries + mutations |
| `src/components/crm/*` (create) | dialogs, opportunities table, field-error helper |
| `src/app/(app)/companies/page.tsx`, `companies/[id]/page.tsx`, `contacts/page.tsx`, `contacts/[id]/page.tsx` (create) | pages |

---

### Task 1: Domain errors, input schemas, search helper, error mapper

**Files:**
- Create: `src/domain/crm/errors.ts`, `src/lib/crm/crm-input.ts`, `src/lib/crm/search.ts`, `src/app/api/crm-errors.ts`
- Test: `src/lib/crm/crm-input.test.ts`, `src/lib/crm/search.test.ts`, `src/app/api/crm-errors.test.ts`

**Interfaces:**
- Produces:
  - `CompanyNotFoundError(id)`, `ContactNotFoundError(id)`, `BrandNotFoundError(id)`, `CompanyNameTakenError(name)`, `CompanyRefNotFoundError(companyId)` (all `extends Error`).
  - `updateCompanySchema` → `{ name: string }`; `updateContactSchema` → `UpdateContactInput`; `updateBrandSchema` → `UpdateBrandInput`.
  - `type UpdateContactInput = { fullName?: string; email?: string | null; phone?: string | null; instagramHandle?: string | null; companyId?: string | null }`
  - `type UpdateBrandInput = { name?: string; companyId?: string | null }`
  - `normalizeSearch(value: string): string`, `matchesSearch(query: string, ...fields: Array<string | null | undefined>): boolean`
  - `COMPANY_NOT_FOUND`, `CONTACT_NOT_FOUND`, `BRAND_NOT_FOUND` (strings), `notFoundResponse(message: string): NextResponse`, `crmErrorResponse(error: unknown): NextResponse | null`

- [ ] **Step 1: Write the failing tests**

`src/lib/crm/crm-input.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { updateBrandSchema, updateCompanySchema, updateContactSchema } from "./crm-input";

const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("updateCompanySchema", () => {
  it("trims the name", () => {
    expect(updateCompanySchema.parse({ name: "  Bella  " })).toEqual({ name: "Bella" });
  });
  it("rejects an empty name", () => {
    const result = updateCompanySchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });
  it("rejects more than 200 chars", () => {
    const result = updateCompanySchema.safeParse({ name: "a".repeat(201) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Use no máximo 200 caracteres.");
  });
});

describe("updateContactSchema", () => {
  it("turns empty strings into null and keeps omitted keys undefined", () => {
    expect(updateContactSchema.parse({ email: "  ", phone: "", fullName: " Maria " })).toEqual({
      fullName: "Maria",
      email: null,
      phone: null,
    });
  });
  it("rejects an invalid e-mail", () => {
    const result = updateContactSchema.safeParse({ email: "nope" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Informe um e-mail válido.");
  });
  it("accepts companyId uuid or null and rejects garbage", () => {
    expect(updateContactSchema.parse({ companyId: ID })).toEqual({ companyId: ID });
    expect(updateContactSchema.parse({ companyId: null })).toEqual({ companyId: null });
    expect(updateContactSchema.safeParse({ companyId: "x" }).success).toBe(false);
  });
  it("requires at least one field", () => {
    const result = updateContactSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["form"]);
      expect(result.error.issues[0].message).toBe("Informe ao menos um campo.");
    }
  });
  it("rejects an empty fullName when present", () => {
    expect(updateContactSchema.safeParse({ fullName: " " }).success).toBe(false);
  });
});

describe("updateBrandSchema", () => {
  it("accepts name and companyId null", () => {
    expect(updateBrandSchema.parse({ name: " Linha Verão ", companyId: null })).toEqual({ name: "Linha Verão", companyId: null });
  });
  it("requires at least one field", () => {
    expect(updateBrandSchema.safeParse({}).success).toBe(false);
  });
});
```

`src/lib/crm/search.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { matchesSearch, normalizeSearch } from "./search";

describe("search", () => {
  it("normalizes accents, case and spaces", () => {
    expect(normalizeSearch("  Bella COSMÉTICOS ")).toBe("bella cosmeticos");
  });
  it("matches any field and ignores null fields", () => {
    expect(matchesSearch("cosme", "Bella Cosméticos", null)).toBe(true);
    expect(matchesSearch("@maria", "Maria", null, "@maria.f")).toBe(true);
    expect(matchesSearch("zzz", "Bella", undefined)).toBe(false);
  });
  it("empty query matches everything", () => {
    expect(matchesSearch("  ", "anything")).toBe(true);
  });
});
```

`src/app/api/crm-errors.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { crmErrorResponse } from "./crm-errors";
import {
  BrandNotFoundError,
  CompanyNameTakenError,
  CompanyNotFoundError,
  CompanyRefNotFoundError,
  ContactNotFoundError,
} from "@/domain/crm/errors";

async function body(response: Response | null) {
  return { status: response?.status, json: await response?.json() };
}

describe("crmErrorResponse", () => {
  it("maps not-found errors to Portuguese 404s", async () => {
    expect(await body(crmErrorResponse(new CompanyNotFoundError("x")))).toEqual({ status: 404, json: { error: "Empresa não encontrada." } });
    expect(await body(crmErrorResponse(new ContactNotFoundError("x")))).toEqual({ status: 404, json: { error: "Contato não encontrado." } });
    expect(await body(crmErrorResponse(new BrandNotFoundError("x")))).toEqual({ status: 404, json: { error: "Brand não encontrada." } });
  });
  it("maps a taken name to 409 and a foreign company ref to 422", async () => {
    expect(await body(crmErrorResponse(new CompanyNameTakenError("Bella")))).toEqual({
      status: 409,
      json: { error: "Já existe uma empresa com esse nome.", code: "COMPANY_NAME_TAKEN" },
    });
    expect(await body(crmErrorResponse(new CompanyRefNotFoundError("x")))).toEqual({
      status: 422,
      json: { error: "Empresa selecionada não encontrada.", code: "COMPANY_NOT_FOUND" },
    });
  });
  it("maps a Postgres deadlock to 409", async () => {
    const result = await body(crmErrorResponse(Object.assign(new Error("deadlock"), { code: "40P01" })));
    expect(result.status).toBe(409);
  });
  it("returns null for unknown errors", () => {
    expect(crmErrorResponse(new Error("boom"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL (modules missing)**

Run: `pnpm vitest run src/lib/crm src/app/api/crm-errors.test.ts --testTimeout=60000`

- [ ] **Step 3: Implement**

`src/domain/crm/errors.ts`:
```ts
export class CompanyNotFoundError extends Error {
  constructor(companyId: string) {
    super(`Company ${companyId} not found`);
    this.name = "CompanyNotFoundError";
  }
}

export class ContactNotFoundError extends Error {
  constructor(contactId: string) {
    super(`Contact ${contactId} not found`);
    this.name = "ContactNotFoundError";
  }
}

export class BrandNotFoundError extends Error {
  constructor(brandId: string) {
    super(`Brand ${brandId} not found`);
    this.name = "BrandNotFoundError";
  }
}

/** Another company of the organization already has this name (case-insensitive, trimmed). */
export class CompanyNameTakenError extends Error {
  constructor(name: string) {
    super(`A company named "${name}" already exists`);
    this.name = "CompanyNameTakenError";
  }
}

/** A companyId in a request body does not exist in the organization. */
export class CompanyRefNotFoundError extends Error {
  constructor(companyId: string) {
    super(`Referenced company ${companyId} not found`);
    this.name = "CompanyRefNotFoundError";
  }
}
```

`src/lib/crm/crm-input.ts`:
```ts
import { z } from "zod";
import { isUuid } from "@/lib/uuid";

const MAX_MESSAGE = "Use no máximo 200 caracteres.";
const AT_LEAST_ONE = { message: "Informe ao menos um campo.", path: ["form"] };

const requiredText = (emptyMessage: string) => z.string().trim().min(1, emptyMessage).max(200, MAX_MESSAGE);

// Omitted → undefined (column untouched); "" or null → null (column cleared).
const nullableText = z
  .string()
  .trim()
  .max(200, MAX_MESSAGE)
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? undefined : value ? value : null));

const nullableEmail = nullableText.refine(
  (value) => value === undefined || value === null || z.email().safeParse(value).success,
  "Informe um e-mail válido.",
);

const companyRef = z
  .string()
  .refine(isUuid, "Empresa inválida.")
  .nullable()
  .optional();

const hasAnyField = (input: Record<string, unknown>) => Object.values(input).some((value) => value !== undefined);

function withoutUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

export const updateCompanySchema = z.object({ name: requiredText("Informe o nome da empresa.") });

export const updateContactSchema = z
  .object({
    fullName: requiredText("Informe o nome.").optional(),
    email: nullableEmail,
    phone: nullableText,
    instagramHandle: nullableText,
    companyId: companyRef,
  })
  .refine(hasAnyField, AT_LEAST_ONE)
  .transform(withoutUndefined);

export const updateBrandSchema = z
  .object({
    name: requiredText("Informe o nome da brand.").optional(),
    companyId: companyRef,
  })
  .refine(hasAnyField, AT_LEAST_ONE)
  .transform(withoutUndefined);

export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
```

`src/lib/crm/search.ts`:
```ts
export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** True when the normalized query is a substring of any non-empty field; an empty query matches everything. */
export function matchesSearch(query: string, ...fields: Array<string | null | undefined>): boolean {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  return fields.some((field) => (field ? normalizeSearch(field).includes(needle) : false));
}
```

`src/app/api/crm-errors.ts`:
```ts
import { NextResponse } from "next/server";
import {
  BrandNotFoundError,
  CompanyNameTakenError,
  CompanyNotFoundError,
  CompanyRefNotFoundError,
  ContactNotFoundError,
} from "@/domain/crm/errors";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

export const COMPANY_NOT_FOUND = "Empresa não encontrada.";
export const CONTACT_NOT_FOUND = "Contato não encontrado.";
export const BRAND_NOT_FOUND = "Brand não encontrada.";

export function notFoundResponse(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** Maps CRM domain errors to user-facing Portuguese responses; null = unknown error (rethrow). */
export function crmErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof CompanyNotFoundError) return notFoundResponse(COMPANY_NOT_FOUND);
  if (error instanceof ContactNotFoundError) return notFoundResponse(CONTACT_NOT_FOUND);
  if (error instanceof BrandNotFoundError) return notFoundResponse(BRAND_NOT_FOUND);
  if (error instanceof CompanyNameTakenError) {
    return NextResponse.json({ error: "Já existe uma empresa com esse nome.", code: "COMPANY_NAME_TAKEN" }, { status: 409 });
  }
  if (error instanceof CompanyRefNotFoundError) {
    return NextResponse.json({ error: "Empresa selecionada não encontrada.", code: "COMPANY_NOT_FOUND" }, { status: 422 });
  }
  if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
  return null;
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `pnpm vitest run src/lib/crm src/app/api/crm-errors.test.ts --testTimeout=60000`
If zod 4 reports the `.refine` path differently for the object-level refine, adjust the assertion to match `["form"]` (the `path` option above sets it) — do not change the message.

- [ ] **Step 5: Commit**

```bash
git add src/domain/crm src/lib/crm src/app/api/crm-errors.ts src/app/api/crm-errors.test.ts
git commit -m "feat(crm): domain errors, PATCH input schemas, search helper, error mapper"
```

---

### Task 2: Read-model repository (lists with counts, details)

**Files:**
- Create: `src/repositories/crm-read.repository.ts`
- Test: `src/repositories/crm-read.repository.test.ts`

**Interfaces:**
- Produces (all `Date` fields are `Date` here; JSON turns them into ISO strings):
```ts
export interface CompanyListItem { id: string; organizationId: string; name: string; createdAt: Date; brandCount: number; contactCount: number; openOpportunityCount: number }
export interface ContactListItem { id: string; organizationId: string; companyId: string | null; fullName: string; email: string | null; phone: string | null; instagramHandle: string | null; createdAt: Date; companyName: string | null }
export interface CrmOpportunityRow { id: string; brandName: string | null; creatorName: string; stage: OpportunityStage; status: "OPEN" | "WON" | "LOST"; estimatedValueCents: number | null; createdAt: Date; proposals: Array<{ id: string; title: string; status: ProposalStatus }> }
export interface CompanyDetail { company: Company; brands: Array<{ id: string; name: string }>; contacts: Array<{ id: string; fullName: string; email: string | null; phone: string | null; instagramHandle: string | null }>; opportunities: CrmOpportunityRow[] }
export interface ContactDetail { contact: Contact; company: { id: string; name: string } | null; opportunities: CrmOpportunityRow[] }
export const CrmReadRepository: {
  listCompanies(db, organizationId): Promise<CompanyListItem[]>;   // newest first
  listContacts(db, organizationId): Promise<ContactListItem[]>;    // newest first
  companyDetail(db, organizationId, companyId): Promise<CompanyDetail | null>;
  contactDetail(db, organizationId, contactId): Promise<ContactDetail | null>;
}
```
(`OpportunityStage` from `@/lib/opportunity-stages`, `ProposalStatus` from `@/lib/proposal-themes`, `Company`/`Contact` from the existing repositories.)

- [ ] **Step 1: Write the failing test**

`src/repositories/crm-read.repository.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { brands, companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { CrmReadRepository } from "./crm-read.repository";

describe("CrmReadRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    // Org A: Bella Cosméticos + contact Maria + open opportunity + proposal "Campanha Verão".
    const a = await seedProposal(db);
    const companyId = a.opportunity.companyId!;
    const [brand] = await db.insert(brands).values({ organizationId: a.organization.id, companyId, name: "Linha Verão" }).returning();
    await db.update(opportunities).set({ brandId: brand.id, estimatedValueCents: 150000 }).where(eq(opportunities.id, a.opportunity.id));
    const [orphanBrand] = await db.insert(brands).values({ organizationId: a.organization.id, companyId: null, name: "Sem Dono" }).returning();
    // A WON opportunity on the same company must not count as open.
    const [lead] = await db.select().from(leads).where(eq(leads.id, a.opportunity.leadId));
    await db.insert(opportunities).values({
      organizationId: a.organization.id,
      creatorId: a.creator.id,
      leadId: lead.id,
      companyId,
      status: "WON",
      stage: "FECHADO",
    });
    // Org B: same-named company, must never leak into org A.
    const b = await seedProposal(db);
    return { db, a, b, companyId, brand, orphanBrand, contactId: lead.contactId };
  }

  it("lists companies with brand, contact and open-opportunity counts, scoped to the org", async () => {
    const { db, a, companyId } = await setup();
    const list = await CrmReadRepository.listCompanies(db, a.organization.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: companyId, name: "Bella Cosméticos", brandCount: 1, contactCount: 1, openOpportunityCount: 1 });
  });

  it("lists contacts with their company name, scoped to the org", async () => {
    const { db, a, contactId } = await setup();
    const list = await CrmReadRepository.listContacts(db, a.organization.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: contactId, fullName: "Maria Fernandes", companyName: "Bella Cosméticos" });
  });

  it("returns the company detail with brands, contacts, opportunities and their proposals", async () => {
    const { db, a, companyId } = await setup();
    const detail = await CrmReadRepository.companyDetail(db, a.organization.id, companyId);
    expect(detail?.company.name).toBe("Bella Cosméticos");
    expect(detail?.brands).toEqual([{ id: expect.any(String), name: "Linha Verão" }]);
    expect(detail?.contacts.map((c) => c.fullName)).toEqual(["Maria Fernandes"]);
    expect(detail?.opportunities).toHaveLength(2);
    const open = detail!.opportunities.find((o) => o.status === "OPEN")!;
    expect(open).toMatchObject({ brandName: "Linha Verão", creatorName: "Thais", estimatedValueCents: 150000 });
    expect(open.proposals).toEqual([{ id: a.proposal.id, title: "Campanha Verão", status: "DRAFT" }]);
  });

  it("returns the contact detail with company and opportunities reached through leads", async () => {
    const { db, a, contactId, companyId } = await setup();
    const detail = await CrmReadRepository.contactDetail(db, a.organization.id, contactId);
    expect(detail?.company).toEqual({ id: companyId, name: "Bella Cosméticos" });
    expect(detail?.opportunities).toHaveLength(2);
  });

  it("returns null for another org's company or contact", async () => {
    const { db, a, b } = await setup();
    const [bLead] = await db.select().from(leads).where(eq(leads.id, b.opportunity.leadId));
    expect(await CrmReadRepository.companyDetail(db, a.organization.id, b.opportunity.companyId!)).toBeNull();
    expect(await CrmReadRepository.contactDetail(db, a.organization.id, bLead.contactId)).toBeNull();
  });

  it("does not count another org's rows that point at a company id (defensive join predicates)", async () => {
    const { db, a, b, companyId } = await setup();
    // A row of org B wrongly pointing at org A's company must not be counted.
    await db.insert(contacts).values({ organizationId: b.organization.id, companyId, fullName: "Intruso" });
    const [row] = await CrmReadRepository.listCompanies(db, a.organization.id);
    expect(row.contactCount).toBe(1);
    const detail = await CrmReadRepository.companyDetail(db, a.organization.id, companyId);
    expect(detail?.contacts.map((c) => c.fullName)).toEqual(["Maria Fernandes"]);
    const companiesOfB = await db.select().from(companies).where(eq(companies.organizationId, b.organization.id));
    expect(companiesOfB).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `pnpm vitest run src/repositories/crm-read.repository.test.ts --testTimeout=60000 --hookTimeout=60000`

- [ ] **Step 3: Implement `src/repositories/crm-read.repository.ts`**

```ts
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { brands, companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { proposals } from "@/db/schema/proposals";
import { creators } from "@/db/schema/creators";
import type { OpportunityStage } from "@/lib/opportunity-stages";
import type { ProposalStatus } from "@/lib/proposal-themes";
import type { Company } from "./companies.repository";
import type { Contact } from "./contacts.repository";
import { runInTenantContext } from "./tenant-context";

type Db = NodePgDatabase<typeof schema>;

export interface CompanyListItem {
  id: string;
  organizationId: string;
  name: string;
  createdAt: Date;
  brandCount: number;
  contactCount: number;
  openOpportunityCount: number;
}

export interface ContactListItem {
  id: string;
  organizationId: string;
  companyId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  instagramHandle: string | null;
  createdAt: Date;
  companyName: string | null;
}

export interface CrmOpportunityRow {
  id: string;
  brandName: string | null;
  creatorName: string;
  stage: OpportunityStage;
  status: "OPEN" | "WON" | "LOST";
  estimatedValueCents: number | null;
  createdAt: Date;
  proposals: Array<{ id: string; title: string; status: ProposalStatus }>;
}

export interface CompanyDetail {
  company: Company;
  brands: Array<{ id: string; name: string }>;
  contacts: Array<{ id: string; fullName: string; email: string | null; phone: string | null; instagramHandle: string | null }>;
  opportunities: CrmOpportunityRow[];
}

export interface ContactDetail {
  contact: Contact;
  company: { id: string; name: string } | null;
  opportunities: CrmOpportunityRow[];
}

// Opportunities matching `where` (already org-scoped by the caller), with
// brand and creator names and their proposals. Every join repeats the
// organization predicate: the app role bypasses RLS.
async function opportunityRows(tx: Db, organizationId: string, where: SQL): Promise<CrmOpportunityRow[]> {
  const rows = await tx
    .select({
      id: opportunities.id,
      brandName: brands.name,
      creatorName: creators.displayName,
      stage: opportunities.stage,
      status: opportunities.status,
      estimatedValueCents: opportunities.estimatedValueCents,
      createdAt: opportunities.createdAt,
    })
    .from(opportunities)
    .innerJoin(creators, and(eq(creators.id, opportunities.creatorId), eq(creators.organizationId, organizationId)))
    .leftJoin(brands, and(eq(brands.id, opportunities.brandId), eq(brands.organizationId, organizationId)))
    .where(and(eq(opportunities.organizationId, organizationId), where))
    .orderBy(desc(opportunities.createdAt));
  if (rows.length === 0) return [];

  const proposalRows = await tx
    .select({ id: proposals.id, title: proposals.title, status: proposals.status, opportunityId: proposals.opportunityId })
    .from(proposals)
    .where(and(eq(proposals.organizationId, organizationId), inArray(proposals.opportunityId, rows.map((row) => row.id))))
    .orderBy(asc(proposals.createdAt));

  return rows.map((row) => ({
    ...row,
    proposals: proposalRows
      .filter((proposal) => proposal.opportunityId === row.id)
      .map(({ id, title, status }) => ({ id, title, status })),
  }));
}

export const CrmReadRepository = {
  async listCompanies(db: Db, organizationId: string): Promise<CompanyListItem[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      tx
        .select({
          id: companies.id,
          organizationId: companies.organizationId,
          name: companies.name,
          createdAt: companies.createdAt,
          brandCount: sql<number>`(select count(*)::int from ${brands} where ${brands.companyId} = ${companies.id} and ${brands.organizationId} = ${organizationId})`,
          contactCount: sql<number>`(select count(*)::int from ${contacts} where ${contacts.companyId} = ${companies.id} and ${contacts.organizationId} = ${organizationId})`,
          openOpportunityCount: sql<number>`(select count(*)::int from ${opportunities} where ${opportunities.companyId} = ${companies.id} and ${opportunities.organizationId} = ${organizationId} and ${opportunities.status} = 'OPEN')`,
        })
        .from(companies)
        .where(eq(companies.organizationId, organizationId))
        .orderBy(desc(companies.createdAt)),
    );
  },

  async listContacts(db: Db, organizationId: string): Promise<ContactListItem[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      tx
        .select({
          id: contacts.id,
          organizationId: contacts.organizationId,
          companyId: contacts.companyId,
          fullName: contacts.fullName,
          email: contacts.email,
          phone: contacts.phone,
          instagramHandle: contacts.instagramHandle,
          createdAt: contacts.createdAt,
          companyName: companies.name,
        })
        .from(contacts)
        .leftJoin(companies, and(eq(companies.id, contacts.companyId), eq(companies.organizationId, organizationId)))
        .where(eq(contacts.organizationId, organizationId))
        .orderBy(desc(contacts.createdAt)),
    );
  },

  async companyDetail(db: Db, organizationId: string, companyId: string): Promise<CompanyDetail | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [company] = await tx
        .select()
        .from(companies)
        .where(and(eq(companies.id, companyId), eq(companies.organizationId, organizationId)));
      if (!company) return null;

      const brandRows = await tx
        .select({ id: brands.id, name: brands.name })
        .from(brands)
        .where(and(eq(brands.companyId, companyId), eq(brands.organizationId, organizationId)))
        .orderBy(asc(brands.name));
      const contactRows = await tx
        .select({
          id: contacts.id,
          fullName: contacts.fullName,
          email: contacts.email,
          phone: contacts.phone,
          instagramHandle: contacts.instagramHandle,
        })
        .from(contacts)
        .where(and(eq(contacts.companyId, companyId), eq(contacts.organizationId, organizationId)))
        .orderBy(asc(contacts.fullName));
      const opportunityList = await opportunityRows(tx, organizationId, eq(opportunities.companyId, companyId));
      return { company, brands: brandRows, contacts: contactRows, opportunities: opportunityList };
    });
  },

  async contactDetail(db: Db, organizationId: string, contactId: string): Promise<ContactDetail | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [contact] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
      if (!contact) return null;

      let company: { id: string; name: string } | null = null;
      if (contact.companyId) {
        const [row] = await tx
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(and(eq(companies.id, contact.companyId), eq(companies.organizationId, organizationId)));
        company = row ?? null;
      }

      const leadIds = tx
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.contactId, contactId), eq(leads.organizationId, organizationId)));
      const opportunityList = await opportunityRows(tx, organizationId, inArray(opportunities.leadId, leadIds));
      return { contact, company, opportunities: opportunityList };
    });
  },
};
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run src/repositories/crm-read.repository.test.ts --testTimeout=60000 --hookTimeout=60000`
If a correlated subquery renders unqualified column names (check the failing SQL in the error), replace `${brands.companyId}` with `${sql.raw('"brands"."company_id"')}`-style qualified references — keep the org predicate.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/crm-read.repository.ts src/repositories/crm-read.repository.test.ts
git commit -m "feat(crm): read model — company/contact lists with counts and detail aggregates"
```

---

### Task 3: Write repositories + `CrmService`

**Files:**
- Modify: `src/repositories/companies.repository.ts`, `src/repositories/contacts.repository.ts`, `src/repositories/brands.repository.ts`
- Create: `src/services/crm.service.ts`
- Test: `src/services/crm.service.test.ts`

**Interfaces:**
- Consumes: Task 1 errors and input types; Task 2 `CrmReadRepository` and its types.
- Produces:
```ts
CompaniesRepository.lockByIdWithTx(tx, organizationId, companyId): Promise<Company | null>
CompaniesRepository.findOtherByNameCiWithTx(tx, organizationId, name, excludeId): Promise<Company | null>
CompaniesRepository.updateNameWithTx(tx, organizationId, companyId, name): Promise<Company>
ContactsRepository.updateWithTx(tx, organizationId, contactId, input: UpdateContactInput): Promise<Contact | null>
BrandsRepository.updateWithTx(tx, organizationId, brandId, input: UpdateBrandInput): Promise<Brand | null>
CrmService.listCompanies(db, orgId): Promise<CompanyListItem[]>
CrmService.listContacts(db, orgId): Promise<ContactListItem[]>
CrmService.getCompanyDetail(db, orgId, id): Promise<CompanyDetail>   // throws CompanyNotFoundError
CrmService.getContactDetail(db, orgId, id): Promise<ContactDetail>   // throws ContactNotFoundError
CrmService.updateCompany(db, orgId, id, { name }): Promise<Company>  // CompanyNotFoundError | CompanyNameTakenError
CrmService.updateContact(db, orgId, id, input): Promise<Contact>     // ContactNotFoundError | CompanyRefNotFoundError
CrmService.updateBrand(db, orgId, id, input): Promise<Brand>         // BrandNotFoundError | CompanyRefNotFoundError
```

- [ ] **Step 1: Write the failing test**

`src/services/crm.service.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { brands, companies, contacts } from "@/db/schema/companies-brands-contacts";
import { CrmService } from "./crm.service";
import {
  BrandNotFoundError,
  CompanyNameTakenError,
  CompanyNotFoundError,
  CompanyRefNotFoundError,
  ContactNotFoundError,
} from "@/domain/crm/errors";

const MISSING = "00000000-0000-4000-8000-0000000000ff";

describe("CrmService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const orgId = a.organization.id;
    const companyId = a.opportunity.companyId!;
    const [other] = await db.insert(companies).values({ organizationId: orgId, name: "Outra Empresa" }).returning();
    const [contact] = await db.insert(contacts).values({ organizationId: orgId, fullName: "João", email: "j@x.com" }).returning();
    const [brand] = await db.insert(brands).values({ organizationId: orgId, companyId, name: "Linha" }).returning();
    const b = await seedProposal(db);
    return { db, orgId, companyId, other, contact, brand, foreignCompanyId: b.opportunity.companyId!, orgB: b.organization.id };
  }

  describe("updateCompany", () => {
    it("renames the company (trimmed input arrives already trimmed from the schema)", async () => {
      const { db, orgId, companyId } = await setup();
      const updated = await CrmService.updateCompany(db, orgId, companyId, { name: "Bella Cosméticos Ltda" });
      expect(updated.name).toBe("Bella Cosméticos Ltda");
    });

    it("allows renaming to its own name with different case", async () => {
      const { db, orgId, companyId } = await setup();
      const updated = await CrmService.updateCompany(db, orgId, companyId, { name: "BELLA COSMÉTICOS" });
      expect(updated.name).toBe("BELLA COSMÉTICOS");
    });

    it("refuses a name another company of the org already has (case/space-insensitive)", async () => {
      const { db, orgId, companyId } = await setup();
      await expect(CrmService.updateCompany(db, orgId, companyId, { name: "outra empresa" })).rejects.toBeInstanceOf(CompanyNameTakenError);
    });

    it("ignores same-named companies of another org", async () => {
      const { db, orgId, other, orgB } = await setup();
      await db.insert(companies).values({ organizationId: orgB, name: "Só da Org B" });
      const updated = await CrmService.updateCompany(db, orgId, other.id, { name: "Só da Org B" });
      expect(updated.name).toBe("Só da Org B");
    });

    it("throws not found for a missing or foreign company", async () => {
      const { db, orgId, foreignCompanyId } = await setup();
      await expect(CrmService.updateCompany(db, orgId, MISSING, { name: "X" })).rejects.toBeInstanceOf(CompanyNotFoundError);
      await expect(CrmService.updateCompany(db, orgId, foreignCompanyId, { name: "X" })).rejects.toBeInstanceOf(CompanyNotFoundError);
    });
  });

  describe("updateContact", () => {
    it("updates only the provided fields and clears nulls", async () => {
      const { db, orgId, contact, companyId } = await setup();
      const updated = await CrmService.updateContact(db, orgId, contact.id, { email: null, companyId, phone: "48 99999-0000" });
      expect(updated).toMatchObject({ fullName: "João", email: null, phone: "48 99999-0000", companyId });
    });

    it("refuses a company of another org", async () => {
      const { db, orgId, contact, foreignCompanyId } = await setup();
      await expect(CrmService.updateContact(db, orgId, contact.id, { companyId: foreignCompanyId })).rejects.toBeInstanceOf(CompanyRefNotFoundError);
    });

    it("throws not found for a missing contact", async () => {
      const { db, orgId } = await setup();
      await expect(CrmService.updateContact(db, orgId, MISSING, { fullName: "X" })).rejects.toBeInstanceOf(ContactNotFoundError);
    });
  });

  describe("updateBrand", () => {
    it("renames and detaches from the company", async () => {
      const { db, orgId, brand } = await setup();
      const updated = await CrmService.updateBrand(db, orgId, brand.id, { name: "Linha Nova", companyId: null });
      expect(updated).toMatchObject({ name: "Linha Nova", companyId: null });
    });

    it("moves to another company of the org and refuses a foreign one", async () => {
      const { db, orgId, brand, other, foreignCompanyId } = await setup();
      expect((await CrmService.updateBrand(db, orgId, brand.id, { companyId: other.id })).companyId).toBe(other.id);
      await expect(CrmService.updateBrand(db, orgId, brand.id, { companyId: foreignCompanyId })).rejects.toBeInstanceOf(CompanyRefNotFoundError);
    });

    it("throws not found for a missing brand", async () => {
      const { db, orgId } = await setup();
      await expect(CrmService.updateBrand(db, orgId, MISSING, { name: "X" })).rejects.toBeInstanceOf(BrandNotFoundError);
    });
  });

  describe("details", () => {
    it("throws not found for missing ids", async () => {
      const { db, orgId } = await setup();
      await expect(CrmService.getCompanyDetail(db, orgId, MISSING)).rejects.toBeInstanceOf(CompanyNotFoundError);
      await expect(CrmService.getContactDetail(db, orgId, MISSING)).rejects.toBeInstanceOf(ContactNotFoundError);
    });
  });
});
```
- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run src/services/crm.service.test.ts --testTimeout=60000 --hookTimeout=60000`

- [ ] **Step 3: Implement**

Append to `CompaniesRepository` in `src/repositories/companies.repository.ts` (add `ne`, `sql` to the drizzle import):
```ts
  async lockByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    companyId: string,
  ): Promise<Company | null> {
    const [row] = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.organizationId, organizationId)))
      .for("update");
    return row ?? null;
  },

  // Case-insensitive, trimmed comparison; no index (small per-org volume, spec D9).
  async findOtherByNameCiWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
    excludeId: string,
  ): Promise<Company | null> {
    const [row] = await tx
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.organizationId, organizationId),
          ne(companies.id, excludeId),
          sql`lower(trim(${companies.name})) = lower(trim(${name}))`,
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async updateNameWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    companyId: string,
    name: string,
  ): Promise<Company> {
    const [row] = await tx
      .update(companies)
      .set({ name })
      .where(and(eq(companies.id, companyId), eq(companies.organizationId, organizationId)))
      .returning();
    return row;
  },
```

Append to `ContactsRepository` (import `type UpdateContactInput` from `@/lib/crm/crm-input`):
```ts
  async updateWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    contactId: string,
    input: UpdateContactInput,
  ): Promise<Contact | null> {
    const [row] = await tx
      .update(contacts)
      .set(input)
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
      .returning();
    return row ?? null;
  },
```

Append to `BrandsRepository` (import `type UpdateBrandInput` from `@/lib/crm/crm-input`):
```ts
  async updateWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    brandId: string,
    input: UpdateBrandInput,
  ): Promise<Brand | null> {
    const [row] = await tx
      .update(brands)
      .set(input)
      .where(and(eq(brands.id, brandId), eq(brands.organizationId, organizationId)))
      .returning();
    return row ?? null;
  },
```

`src/services/crm.service.ts`:
```ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { CompaniesRepository, type Company } from "@/repositories/companies.repository";
import { ContactsRepository, type Contact } from "@/repositories/contacts.repository";
import { BrandsRepository, type Brand } from "@/repositories/brands.repository";
import {
  CrmReadRepository,
  type CompanyDetail,
  type CompanyListItem,
  type ContactDetail,
  type ContactListItem,
} from "@/repositories/crm-read.repository";
import {
  BrandNotFoundError,
  CompanyNameTakenError,
  CompanyNotFoundError,
  CompanyRefNotFoundError,
  ContactNotFoundError,
} from "@/domain/crm/errors";
import type { UpdateBrandInput, UpdateContactInput } from "@/lib/crm/crm-input";

type Db = NodePgDatabase<typeof schema>;

async function assertCompanyInOrg(tx: Db, organizationId: string, companyId: string | null | undefined) {
  if (!companyId) return;
  const company = await CompaniesRepository.findByIdWithTx(tx, organizationId, companyId);
  if (!company) throw new CompanyRefNotFoundError(companyId);
}

export const CrmService = {
  listCompanies(db: Db, organizationId: string): Promise<CompanyListItem[]> {
    return CrmReadRepository.listCompanies(db, organizationId);
  },

  listContacts(db: Db, organizationId: string): Promise<ContactListItem[]> {
    return CrmReadRepository.listContacts(db, organizationId);
  },

  async getCompanyDetail(db: Db, organizationId: string, companyId: string): Promise<CompanyDetail> {
    const detail = await CrmReadRepository.companyDetail(db, organizationId, companyId);
    if (!detail) throw new CompanyNotFoundError(companyId);
    return detail;
  },

  async getContactDetail(db: Db, organizationId: string, contactId: string): Promise<ContactDetail> {
    const detail = await CrmReadRepository.contactDetail(db, organizationId, contactId);
    if (!detail) throw new ContactNotFoundError(contactId);
    return detail;
  },

  // Row lock serializes concurrent renames of the same company. Two renames of
  // *different* companies to the same name can still race (no unique index) —
  // accepted in the spec; merging duplicates is a later spec.
  async updateCompany(db: Db, organizationId: string, companyId: string, input: { name: string }): Promise<Company> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const company = await CompaniesRepository.lockByIdWithTx(tx, organizationId, companyId);
      if (!company) throw new CompanyNotFoundError(companyId);
      const taken = await CompaniesRepository.findOtherByNameCiWithTx(tx, organizationId, input.name, companyId);
      if (taken) throw new CompanyNameTakenError(input.name);
      return CompaniesRepository.updateNameWithTx(tx, organizationId, companyId, input.name);
    });
  },

  async updateContact(db: Db, organizationId: string, contactId: string, input: UpdateContactInput): Promise<Contact> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const existing = await ContactsRepository.findByIdWithTx(tx, organizationId, contactId);
      if (!existing) throw new ContactNotFoundError(contactId);
      await assertCompanyInOrg(tx, organizationId, input.companyId);
      const updated = await ContactsRepository.updateWithTx(tx, organizationId, contactId, input);
      if (!updated) throw new ContactNotFoundError(contactId);
      return updated;
    });
  },

  async updateBrand(db: Db, organizationId: string, brandId: string, input: UpdateBrandInput): Promise<Brand> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const existing = await BrandsRepository.findByIdWithTx(tx, organizationId, brandId);
      if (!existing) throw new BrandNotFoundError(brandId);
      await assertCompanyInOrg(tx, organizationId, input.companyId);
      const updated = await BrandsRepository.updateWithTx(tx, organizationId, brandId, input);
      if (!updated) throw new BrandNotFoundError(brandId);
      return updated;
    });
  },
};
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run src/services/crm.service.test.ts src/repositories --testTimeout=60000 --hookTimeout=60000`

- [ ] **Step 5: Commit**

```bash
git add src/repositories src/services/crm.service.ts src/services/crm.service.test.ts
git commit -m "feat(crm): CrmService — company rename with duplicate check, contact/brand edit with org check"
```

---

### Task 4: API routes (lists, details, PATCH ×3) + guard tests

**Files:**
- Modify: `src/app/api/companies/route.ts`, `src/app/api/companies/[id]/route.ts`, `src/app/api/contacts/route.ts`, `src/app/api/contacts/[id]/route.ts`, `src/app/api/id-guard.test.ts`, existing tests `src/app/api/companies/[id]/route.test.ts`, `src/app/api/contacts/[id]/route.test.ts`
- Create: `src/app/api/brands/[id]/route.ts`, `src/app/api/brands/[id]/route.test.ts`
- Delete: `src/services/company.service.ts`, `src/services/contact.service.ts` (and their `*.test.ts` if present) once nothing imports them (`grep -rn "CompanyService\|ContactService" src`).

**Interfaces:**
- Consumes: `CrmService` (Task 3); `crmErrorResponse`, `notFoundResponse`, `COMPANY_NOT_FOUND`, `CONTACT_NOT_FOUND`, `BRAND_NOT_FOUND` (Task 1); schemas (Task 1).
- Produces (HTTP):
  - `GET /api/companies` → `CompanyListItem[]`; `GET /api/contacts` → `ContactListItem[]`
  - `GET /api/companies/[id]` → `CompanyDetail`; `PATCH` → `Company`
  - `GET /api/contacts/[id]` → `ContactDetail`; `PATCH` → `Contact`
  - `PATCH /api/brands/[id]` → `Brand`

- [ ] **Step 1: Write / update the failing tests**

In `src/app/api/companies/[id]/route.test.ts`:
- Change the 200 test to assert the detail shape: `expect(json.company.id).toBe(company.id); expect(json.brands).toEqual([]); expect(json.contacts).toEqual([]); expect(json.opportunities).toEqual([]);`
- Change the 404 test to `expect(json).toEqual({ error: "Empresa não encontrada." });`
- Add PATCH tests (same file, reuse its setup style):
```ts
describe("PATCH /api/companies/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(session: "owner" | "creator" | "none" = "owner") {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    const companyId = seeded.opportunity.companyId!;
    const [other] = await db.insert(companies).values({ organizationId: seeded.organization.id, name: "Outra" }).returning();
    const sessionValue =
      session === "owner"
        ? ownerSession(seeded.organization.id, seeded.owner.id)
        : session === "creator"
          ? creatorSession(seeded.organization.id, seeded.owner.id, seeded.creator.id)
          : null;
    const { PATCH } = await importRouteWithSession(() => import("./route"), { db, session: sessionValue });
    const call = (id: string, body: unknown) =>
      PATCH(
        new Request(`http://localhost/api/companies/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) },
      );
    return { call, companyId, other };
  }

  it("renames the company", async () => {
    const { call, companyId } = await setup();
    const response = await call(companyId, { name: "  Bella Ltda  " });
    expect(response.status).toBe(200);
    expect((await response.json()).name).toBe("Bella Ltda");
  });

  it("returns 409 COMPANY_NAME_TAKEN for a duplicate name", async () => {
    const { call, companyId } = await setup();
    const response = await call(companyId, { name: "OUTRA" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Já existe uma empresa com esse nome.", code: "COMPANY_NAME_TAKEN" });
  });

  it("returns 400 with field errors for an empty name", async () => {
    const { call, companyId } = await setup();
    const response = await call(companyId, { name: " " });
    expect(response.status).toBe(400);
    expect((await response.json()).errors.name).toBeDefined();
  });

  it("returns 404 for an unknown id", async () => {
    const { call } = await setup();
    const response = await call("00000000-0000-4000-8000-0000000000ff", { name: "X" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Empresa não encontrada." });
  });

  it("returns 403 for a CREATOR and 401 without a session", async () => {
    expect((await (await setup("creator")).call("00000000-0000-4000-8000-0000000000ff", { name: "X" })).status).toBe(403);
    expect((await (await setup("none")).call("00000000-0000-4000-8000-0000000000ff", { name: "X" })).status).toBe(401);
  });
});
```
(Imports to add: `seedProposal` from `@/test/helpers/proposal-fixtures`, `companies` from `@/db/schema/companies-brands-contacts`, `creatorSession` from `@/test/helpers/route`, and keep `afterEach`.)

In `src/app/api/contacts/[id]/route.test.ts`: same changes for GET (detail shape `json.contact.id`, `json.company`, `json.opportunities`; 404 body `{ error: "Contato não encontrado." }`) and a PATCH block with these cases — success (`{ fullName: "Maria F.", email: "" }` → 200, `email: null`), 422 for a foreign `companyId` (seed a second org with `seedProposal` and use its `opportunity.companyId`; body `{ error: "Empresa selecionada não encontrada.", code: "COMPANY_NOT_FOUND" }`), 400 for `{ email: "nope" }` (`errors.email` defined), 400 for `{}` (`errors.form` defined), 404 unknown id, 403 creator, 401 none. Get the contact id from `seedProposal` via `db.select().from(leads).where(eq(leads.id, seeded.opportunity.leadId))` → `contactId`.

Create `src/app/api/brands/[id]/route.test.ts` with PATCH cases: success rename + detach (`{ name: "Nova", companyId: null }` → 200, `companyId: null`), 422 foreign company, 400 `{}`, 404 unknown (`{ error: "Brand não encontrada." }`), 403 creator, 401 none. Seed the brand with `db.insert(brands).values({ organizationId, companyId, name: "Linha" })`.

In `src/app/api/companies/route.test.ts` and `src/app/api/contacts/route.test.ts`, extend the existing 200 test: companies items have numeric `brandCount`, `contactCount`, `openOpportunityCount`; contacts items have `companyName` (string or null).

In `src/app/api/id-guard.test.ts`:
- import `{ BRAND_NOT_FOUND, COMPANY_NOT_FOUND, CONTACT_NOT_FOUND } from "./crm-errors"`;
- replace the `companies/[id]` and `contacts/[id]` cases with `methods: ["GET", "PATCH"]` and `error: COMPANY_NOT_FOUND` / `CONTACT_NOT_FOUND`;
- add `{ route: "brands/[id]", load: () => import("./brands/[id]/route"), methods: ["PATCH"], error: BRAND_NOT_FOUND }`.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run src/app/api/companies src/app/api/contacts src/app/api/brands src/app/api/id-guard.test.ts --testTimeout=60000 --hookTimeout=60000`

- [ ] **Step 3: Implement the routes**

`src/app/api/companies/route.ts`:
```ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { CrmService } from "@/services/crm.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";

export async function GET(_request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const list = await CrmService.listCompanies(db, session.organizationId);
  return NextResponse.json(list, { status: 200 });
}
```
`src/app/api/contacts/route.ts`: identical with `CrmService.listContacts`.

`src/app/api/companies/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CrmService } from "@/services/crm.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";
import { isUuid } from "@/lib/uuid";
import { updateCompanySchema } from "@/lib/crm/crm-input";
import { COMPANY_NOT_FOUND, crmErrorResponse, notFoundResponse } from "../../crm-errors";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const { id } = await params;
  if (!isUuid(id)) return notFoundResponse(COMPANY_NOT_FOUND);
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  try {
    return NextResponse.json(await CrmService.getCompanyDetail(db, session.organizationId, id), { status: 200 });
  } catch (error) {
    const mapped = crmErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const { id } = await params;
  if (!isUuid(id)) return notFoundResponse(COMPANY_NOT_FOUND);
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const parsed = updateCompanySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    return NextResponse.json(await CrmService.updateCompany(db, session.organizationId, id, parsed.data), { status: 200 });
  } catch (error) {
    const mapped = crmErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
```

`src/app/api/contacts/[id]/route.ts`: same structure with `CONTACT_NOT_FOUND`, `CrmService.getContactDetail`, `updateContactSchema`, `CrmService.updateContact`.

`src/app/api/brands/[id]/route.ts`: PATCH only, with `BRAND_NOT_FOUND`, `updateBrandSchema`, `CrmService.updateBrand` (import path `../../crm-errors`).

Note the order kept from the existing routes: session → `isUuid` → role. The id-guard test calls with an OWNER session, so a malformed id must 404 before the body is parsed (body is `"not json"` there).

Then delete the superseded services:
```bash
grep -rn "CompanyService\|ContactService" src   # must only list the files being deleted
git rm src/services/company.service.ts src/services/contact.service.ts
git rm -f src/services/company.service.test.ts src/services/contact.service.test.ts 2>/dev/null || true
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run src/app/api --testTimeout=60000 --hookTimeout=60000` (includes `write-guard.test.ts`, which must pass: every new PATCH calls `canManageOrganization(`).

- [ ] **Step 5: Commit**

```bash
git add -A src/app/api src/services
git commit -m "feat(api): company/contact detail + PATCH, brand PATCH, Portuguese 404s"
```

---

### Task 5: Client hooks

**Files:**
- Create: `src/hooks/use-crm.ts`
- Test: `src/hooks/use-crm.test.tsx`

**Interfaces:**
- Consumes: HTTP contracts of Task 4.
- Produces:
```ts
export interface CompanyListItemDto { id: string; name: string; createdAt: string; brandCount: number; contactCount: number; openOpportunityCount: number }
export interface ContactListItemDto { id: string; companyId: string | null; fullName: string; email: string | null; phone: string | null; instagramHandle: string | null; createdAt: string; companyName: string | null }
export interface BrandDto { id: string; name: string; companyId: string | null }
export interface CrmOpportunityDto { id: string; brandName: string | null; creatorName: string; stage: OpportunityStage; status: "OPEN" | "WON" | "LOST"; estimatedValueCents: number | null; createdAt: string; proposals: Array<{ id: string; title: string; status: ProposalStatus }> }
export interface CompanyDto { id: string; name: string; createdAt: string }
export interface ContactDto { id: string; companyId: string | null; fullName: string; email: string | null; phone: string | null; instagramHandle: string | null; createdAt: string }
export interface CompanyDetailDto { company: CompanyDto; brands: Array<{ id: string; name: string }>; contacts: Array<{ id: string; fullName: string; email: string | null; phone: string | null; instagramHandle: string | null }>; opportunities: CrmOpportunityDto[] }
export interface ContactDetailDto { contact: ContactDto; company: { id: string; name: string } | null; opportunities: CrmOpportunityDto[] }
export interface ContactFormValues { fullName: string; email: string; phone: string; instagramHandle: string; companyId: string | null }
export interface BrandFormValues { name: string; companyId: string | null }
export const crmQueryKey = ["crm"] as const;
useCompanies(), useCompany(id), useContacts(), useContact(id), useBrands()
useUpdateCompany(id) → mutateAsync({ name }) : CompanyDto
useUpdateContact(id) → mutateAsync(ContactFormValues) : ContactDto
useUpdateBrand(id)   → mutateAsync(BrandFormValues) : BrandDto
```
Every mutation invalidates `crmQueryKey` (prefix: all lists and details) and the inbox selector keys `["company-options"]`, `["brand-options"]`, `["contact-options"]`.

- [ ] **Step 1: Write the failing test**

`src/hooks/use-crm.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { crmQueryKey, useCompanies, useCompany, useContact, useUpdateBrand, useUpdateCompany, useUpdateContact } from "./use-crm";

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("crm hooks", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists companies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok([{ id: "c1", name: "Bella" }]));
    const { result } = renderHook(() => useCompanies(), { wrapper: wrapper(new QueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: "c1", name: "Bella" }]));
  });

  it("loads details by id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ company: { id: "c1" } }));
    const client = new QueryClient();
    renderHook(() => useCompany("c1"), { wrapper: wrapper(client) });
    renderHook(() => useContact("p1"), { wrapper: wrapper(client) });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/companies/c1", undefined);
      expect(fetchMock).toHaveBeenCalledWith("/api/contacts/p1", undefined);
    });
  });

  it("updates a company and invalidates crm + inbox option keys", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: "c1", name: "Nova" }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateCompany("c1"), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ name: "Nova" });
    expect(fetchMock).toHaveBeenCalledWith("/api/companies/c1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nova" }),
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: crmQueryKey });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["company-options"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["brand-options"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["contact-options"] });
    });
  });

  it("PATCHes contacts and brands by id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: "x" }));
    const client = new QueryClient();
    const contact = renderHook(() => useUpdateContact("p1"), { wrapper: wrapper(client) });
    await contact.result.current.mutateAsync({ fullName: "Maria", email: "", phone: "", instagramHandle: "", companyId: null });
    const brand = renderHook(() => useUpdateBrand("b1"), { wrapper: wrapper(client) });
    await brand.result.current.mutateAsync({ name: "Linha", companyId: "c1" });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/contacts/p1", "/api/brands/b1"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run src/hooks/use-crm.test.tsx`

- [ ] **Step 3: Implement `src/hooks/use-crm.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { OpportunityStage } from "@/lib/opportunity-stages";
import type { ProposalStatus } from "@/lib/proposal-themes";

export interface CompanyListItemDto {
  id: string;
  name: string;
  createdAt: string;
  brandCount: number;
  contactCount: number;
  openOpportunityCount: number;
}

export interface ContactListItemDto {
  id: string;
  companyId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  instagramHandle: string | null;
  createdAt: string;
  companyName: string | null;
}

export interface BrandDto {
  id: string;
  name: string;
  companyId: string | null;
}

export interface CrmOpportunityDto {
  id: string;
  brandName: string | null;
  creatorName: string;
  stage: OpportunityStage;
  status: "OPEN" | "WON" | "LOST";
  estimatedValueCents: number | null;
  createdAt: string;
  proposals: Array<{ id: string; title: string; status: ProposalStatus }>;
}

export interface CompanyDto {
  id: string;
  name: string;
  createdAt: string;
}

export interface ContactDto {
  id: string;
  companyId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  instagramHandle: string | null;
  createdAt: string;
}

export interface CompanyDetailDto {
  company: CompanyDto;
  brands: Array<{ id: string; name: string }>;
  contacts: Array<{ id: string; fullName: string; email: string | null; phone: string | null; instagramHandle: string | null }>;
  opportunities: CrmOpportunityDto[];
}

export interface ContactDetailDto {
  contact: ContactDto;
  company: { id: string; name: string } | null;
  opportunities: CrmOpportunityDto[];
}

export interface ContactFormValues {
  fullName: string;
  email: string;
  phone: string;
  instagramHandle: string;
  companyId: string | null;
}

export interface BrandFormValues {
  name: string;
  companyId: string | null;
}

export const crmQueryKey = ["crm"] as const;
// Inbox selectors (use-party-options) read the same lists; renames must show up there too.
const OPTION_KEYS = [["company-options"], ["brand-options"], ["contact-options"]] as const;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function useCrmMutation<TValues, TResult>(url: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: TValues) => apiFetch<TResult>(url, json("PATCH", values)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: crmQueryKey });
      for (const queryKey of OPTION_KEYS) void queryClient.invalidateQueries({ queryKey });
    },
  });
}

export function useCompanies() {
  return useQuery({ queryKey: [...crmQueryKey, "companies"], queryFn: () => apiFetch<CompanyListItemDto[]>("/api/companies") });
}

export function useCompany(companyId: string) {
  return useQuery({ queryKey: [...crmQueryKey, "company", companyId], queryFn: () => apiFetch<CompanyDetailDto>(`/api/companies/${companyId}`) });
}

export function useContacts() {
  return useQuery({ queryKey: [...crmQueryKey, "contacts"], queryFn: () => apiFetch<ContactListItemDto[]>("/api/contacts") });
}

export function useContact(contactId: string) {
  return useQuery({ queryKey: [...crmQueryKey, "contact", contactId], queryFn: () => apiFetch<ContactDetailDto>(`/api/contacts/${contactId}`) });
}

export function useBrands() {
  return useQuery({ queryKey: [...crmQueryKey, "brands"], queryFn: () => apiFetch<BrandDto[]>("/api/brands") });
}

export function useUpdateCompany(companyId: string) {
  return useCrmMutation<{ name: string }, CompanyDto>(`/api/companies/${companyId}`);
}

export function useUpdateContact(contactId: string) {
  return useCrmMutation<ContactFormValues, ContactDto>(`/api/contacts/${contactId}`);
}

export function useUpdateBrand(brandId: string) {
  return useCrmMutation<BrandFormValues, BrandDto>(`/api/brands/${brandId}`);
}
```
Note: `apiFetch(url)` is called with one argument for GETs; the test asserts `fetch` received `(url, undefined)` — matches `fetch(url, init)` in `apiFetch`.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run src/hooks/use-crm.test.tsx src/hooks/use-party-options.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-crm.ts src/hooks/use-crm.test.tsx
git commit -m "feat(crm): query and mutation hooks for companies, contacts and brands"
```

---

### Task 6: CRM components (dialogs, opportunities table)

**Files:**
- Create: `src/components/crm/form-errors.ts`, `src/components/crm/company-select.tsx`, `src/components/crm/company-form-dialog.tsx`, `src/components/crm/contact-form-dialog.tsx`, `src/components/crm/brand-form-dialog.tsx`, `src/components/crm/crm-opportunities-table.tsx`
- Test: `src/components/crm/form-errors.test.ts`, `src/components/crm/company-form-dialog.test.tsx`, `src/components/crm/contact-form-dialog.test.tsx`, `src/components/crm/brand-form-dialog.test.tsx`, `src/components/crm/crm-opportunities-table.test.tsx`

**Interfaces:**
- Consumes: Task 5 hooks and DTOs; `Combobox` (`@/components/ui/combobox`, props `items, getLabel, getValue, value, onSelect, placeholder, aria-label`); `ApiError`; `STAGE_LABELS` (`@/lib/opportunity-stages`); `ProposalStatusBadge` (`@/components/proposals/proposal-status-badge`); `formatCurrencyBRL` (`@/lib/format`).
- Produces:
```ts
toFormErrors<F extends string>(error: unknown, fields: readonly F[], conflictField?: F): { fieldErrors: Partial<Record<F, string>>; formError: string | null }
<CompanyFormDialog open company={{ id, name }} onOpenChange onSaved={(company: CompanyDto) => void} />
<ContactFormDialog open contact={ContactDto} onOpenChange onSaved={(contact: ContactDto) => void} />
<BrandFormDialog open brand={{ id, name, companyId }} onOpenChange onSaved={(brand: BrandDto) => void} />
<CrmOpportunitiesTable opportunities={CrmOpportunityDto[]} />
```
The company combobox (contact and brand dialogs) lists `useCompanies()` data plus a first item `{ id: "", name: "Sem empresa" }`; selecting it sets `companyId` to `null`.

- [ ] **Step 1: Write the failing tests**

`src/components/crm/form-errors.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-client";
import { toFormErrors } from "./form-errors";

const FIELDS = ["name", "companyId"] as const;

describe("toFormErrors", () => {
  it("puts a 409 under the conflict field", () => {
    expect(toFormErrors(new ApiError(409, "Já existe uma empresa com esse nome."), FIELDS, "name")).toEqual({
      fieldErrors: { name: "Já existe uma empresa com esse nome." },
      formError: null,
    });
  });
  it("maps 400 field errors and keeps form-level errors as formError", () => {
    expect(toFormErrors(new ApiError(400, "x", { errors: { name: ["Informe o nome."] } }), FIELDS)).toEqual({
      fieldErrors: { name: "Informe o nome." },
      formError: null,
    });
    expect(toFormErrors(new ApiError(400, "Informe ao menos um campo.", { errors: { form: ["Informe ao menos um campo."] } }), FIELDS)).toEqual({
      fieldErrors: {},
      formError: "Informe ao menos um campo.",
    });
  });
  it("puts a 422 company error under companyId when that field exists", () => {
    expect(toFormErrors(new ApiError(422, "Empresa selecionada não encontrada.", { code: "COMPANY_NOT_FOUND" }), FIELDS)).toEqual({
      fieldErrors: { companyId: "Empresa selecionada não encontrada." },
      formError: null,
    });
  });
  it("falls back to a generic message for non-API errors", () => {
    expect(toFormErrors(new Error("x"), FIELDS).formError).toBe("Não foi possível salvar. Tente novamente.");
  });
});
```

`src/components/crm/company-form-dialog.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const mutateAsync = vi.fn();
vi.mock("@/hooks/use-crm", () => ({ useUpdateCompany: () => ({ mutateAsync, isPending: false }) }));

import { CompanyFormDialog } from "./company-form-dialog";

describe("CompanyFormDialog", () => {
  beforeEach(() => mutateAsync.mockReset());

  it("saves the new name", async () => {
    const onSaved = vi.fn();
    mutateAsync.mockResolvedValue({ id: "c1", name: "Bella Ltda" });
    render(<CompanyFormDialog open company={{ id: "c1", name: "Bella" }} onOpenChange={() => {}} onSaved={onSaved} />);
    const input = screen.getByLabelText("Nome da empresa");
    await userEvent.clear(input);
    await userEvent.type(input, "Bella Ltda");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(mutateAsync).toHaveBeenCalledWith({ name: "Bella Ltda" });
    expect(onSaved).toHaveBeenCalledWith({ id: "c1", name: "Bella Ltda" });
  });

  it("shows the 409 under the name field", async () => {
    mutateAsync.mockRejectedValue(new ApiError(409, "Já existe uma empresa com esse nome.", { code: "COMPANY_NAME_TAKEN" }));
    render(<CompanyFormDialog open company={{ id: "c1", name: "Bella" }} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Já existe uma empresa com esse nome.")).toBeTruthy();
    expect(screen.getByLabelText("Nome da empresa").getAttribute("aria-invalid")).toBe("true");
  });
});
```

`src/components/crm/contact-form-dialog.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const mutateAsync = vi.fn();
vi.mock("@/hooks/use-crm", () => ({
  useUpdateContact: () => ({ mutateAsync, isPending: false }),
  useCompanies: () => ({ data: [{ id: "c1", name: "Bella" }] }),
}));

import { ContactFormDialog } from "./contact-form-dialog";

const contact = { id: "p1", companyId: "c1", fullName: "Maria", email: "m@x.com", phone: null, instagramHandle: null, createdAt: "2026-10-01T00:00:00.000Z" };

describe("ContactFormDialog", () => {
  beforeEach(() => mutateAsync.mockReset());

  it("submits all fields with empty strings for blanks", async () => {
    mutateAsync.mockResolvedValue({ ...contact, fullName: "Maria F." });
    const onSaved = vi.fn();
    render(<ContactFormDialog open contact={contact} onOpenChange={() => {}} onSaved={onSaved} />);
    const name = screen.getByLabelText("Nome");
    await userEvent.clear(name);
    await userEvent.type(name, "Maria F.");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(mutateAsync).toHaveBeenCalledWith({ fullName: "Maria F.", email: "m@x.com", phone: "", instagramHandle: "", companyId: "c1" });
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows a 400 e-mail error under the e-mail field", async () => {
    mutateAsync.mockRejectedValue(new ApiError(400, "Informe um e-mail válido.", { errors: { email: ["Informe um e-mail válido."] } }));
    render(<ContactFormDialog open contact={contact} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Informe um e-mail válido.")).toBeTruthy();
  });
});
```

`src/components/crm/brand-form-dialog.test.tsx`: same structure as the company dialog test, mocking `useUpdateBrand` and `useCompanies`, with brand `{ id: "b1", name: "Linha", companyId: "c1" }`; asserts submit sends `{ name: "Linha Nova", companyId: "c1" }` after editing the field labelled "Nome da brand", and that a 422 `{ code: "COMPANY_NOT_FOUND" }` error text "Empresa selecionada não encontrada." appears.

`src/components/crm/crm-opportunities-table.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CrmOpportunitiesTable } from "./crm-opportunities-table";

describe("CrmOpportunitiesTable", () => {
  it("shows brand, creator, stage label, BRL value and proposal links", () => {
    render(
      <CrmOpportunitiesTable
        opportunities={[
          {
            id: "o1",
            brandName: "Linha Verão",
            creatorName: "Thais",
            stage: "PROPOSTA_ENVIADA",
            status: "OPEN",
            estimatedValueCents: 150000,
            createdAt: "2026-10-01T00:00:00.000Z",
            proposals: [{ id: "p1", title: "Campanha Verão", status: "SENT" }],
          },
        ]}
      />,
    );
    expect(screen.getByText("Linha Verão")).toBeTruthy();
    expect(screen.getByText("Thais")).toBeTruthy();
    expect(screen.getByText(/R\$\s?1\.500,00/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Campanha Verão" }).getAttribute("href")).toBe("/proposals/p1");
  });

  it("shows an empty message without opportunities", () => {
    render(<CrmOpportunitiesTable opportunities={[]} />);
    expect(screen.getByText("Nenhuma oportunidade.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run src/components/crm`

- [ ] **Step 3: Implement**

`src/components/crm/form-errors.ts`:
```ts
import { ApiError } from "@/lib/api-client";

export interface FormErrors<F extends string> {
  fieldErrors: Partial<Record<F, string>>;
  formError: string | null;
}

/** Same idea as creator-form-dialog's toFieldErrors, shared by the CRM dialogs. */
export function toFormErrors<F extends string>(error: unknown, fields: readonly F[], conflictField?: F): FormErrors<F> {
  if (!(error instanceof ApiError)) {
    return { fieldErrors: {}, formError: "Não foi possível salvar. Tente novamente." };
  }
  if (error.status === 409 && conflictField) {
    return { fieldErrors: { [conflictField]: error.message } as Partial<Record<F, string>>, formError: null };
  }
  const code = (error.body as { code?: string } | null)?.code;
  if (code === "COMPANY_NOT_FOUND" && (fields as readonly string[]).includes("companyId")) {
    return { fieldErrors: { companyId: error.message } as Partial<Record<F, string>>, formError: null };
  }
  const errors = (error.body as { errors?: Record<string, string[] | undefined> } | null)?.errors ?? {};
  const fieldErrors: Partial<Record<F, string>> = {};
  for (const field of fields) {
    const first = errors[field]?.[0];
    if (first) fieldErrors[field] = first;
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, formError: null };
  return { fieldErrors: {}, formError: error.message };
}
```

`src/components/crm/company-form-dialog.tsx`:
```tsx
"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateCompany, type CompanyDto } from "@/hooks/use-crm";
import { toFormErrors } from "./form-errors";

export function CompanyFormDialog({
  open,
  company,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  company: { id: string; name: string };
  onOpenChange: (open: boolean) => void;
  onSaved: (company: CompanyDto) => void;
}) {
  const update = useUpdateCompany(company.id);
  const [name, setName] = React.useState(company.name);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setNameError(null);
    setFormError(null);
    try {
      onSaved(await update.mutateAsync({ name }));
    } catch (error) {
      const result = toFormErrors(error, ["name"] as const, "name");
      setNameError(result.fieldErrors.name ?? null);
      setFormError(result.formError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar empresa</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1 text-sm">
              Nome da empresa
              <Input
                value={name}
                maxLength={200}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(null);
                }}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "company-name-error" : undefined}
              />
            </label>
            {nameError ? (
              <p id="company-name-error" className="text-xs text-error">
                {nameError}
              </p>
            ) : null}
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-error">
              {formError}
            </p>
          ) : null}
          <Button type="submit" disabled={update.isPending}>
            Salvar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`src/components/crm/company-select.tsx` (shared by contact and brand dialogs):
```tsx
"use client";

import { Combobox } from "@/components/ui/combobox";
import { useCompanies } from "@/hooks/use-crm";

const NONE = { id: "", name: "Sem empresa" };

export function CompanySelect({ value, onChange }: { value: string | null; onChange: (companyId: string | null) => void }) {
  const { data } = useCompanies();
  const items = [NONE, ...(data ?? []).map(({ id, name }) => ({ id, name }))];
  return (
    <Combobox
      items={items}
      getLabel={(item) => item.name}
      getValue={(item) => item.id}
      value={value ?? ""}
      onSelect={(item) => onChange(item.id || null)}
      placeholder="Selecionar empresa"
      aria-label="Empresa"
    />
  );
}
```

`src/components/crm/contact-form-dialog.tsx`:
```tsx
"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateContact, type ContactDto, type ContactFormValues } from "@/hooks/use-crm";
import { CompanySelect } from "./company-select";
import { toFormErrors } from "./form-errors";

const FIELDS = ["fullName", "email", "phone", "instagramHandle", "companyId"] as const;
type Field = (typeof FIELDS)[number];

export function ContactFormDialog({
  open,
  contact,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  contact: ContactDto;
  onOpenChange: (open: boolean) => void;
  onSaved: (contact: ContactDto) => void;
}) {
  const update = useUpdateContact(contact.id);
  const [values, setValues] = React.useState<ContactFormValues>({
    fullName: contact.fullName,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    instagramHandle: contact.instagramHandle ?? "",
    companyId: contact.companyId,
  });
  const [errors, setErrors] = React.useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  function set<K extends Field>(name: K, value: ContactFormValues[K]) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors(({ [name]: _removed, ...rest }) => rest);
  }

  function textField(name: Exclude<Field, "companyId">, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) {
    const errorId = `contact-${name}-error`;
    return (
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-sm">
          {label}
          <Input
            value={values[name]}
            maxLength={200}
            onChange={(event) => set(name, event.target.value)}
            aria-invalid={errors[name] ? true : undefined}
            aria-describedby={errors[name] ? errorId : undefined}
            {...extra}
          />
        </label>
        {errors[name] ? (
          <p id={errorId} className="text-xs text-error">
            {errors[name]}
          </p>
        ) : null}
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      onSaved(await update.mutateAsync(values));
    } catch (error) {
      const result = toFormErrors(error, FIELDS);
      setErrors(result.fieldErrors);
      setFormError(result.formError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar contato</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {textField("fullName", "Nome", { autoComplete: "name" })}
          {textField("email", "E-mail", { type: "email" })}
          {textField("phone", "Telefone", { type: "tel" })}
          {textField("instagramHandle", "@Instagram")}
          <div className="flex flex-col gap-1 text-sm">
            <span>Empresa</span>
            <CompanySelect value={values.companyId} onChange={(companyId) => set("companyId", companyId)} />
            {errors.companyId ? <p className="text-xs text-error">{errors.companyId}</p> : null}
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-error">
              {formError}
            </p>
          ) : null}
          <Button type="submit" disabled={update.isPending}>
            Salvar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```
In the contact dialog test, mock `@/hooks/use-crm` with both `useUpdateContact` and `useCompanies` (as written above) — `CompanySelect` reads `useCompanies`.

`src/components/crm/brand-form-dialog.tsx`: same structure as the contact dialog with `FIELDS = ["name", "companyId"] as const`, one text field labelled "Nome da brand" (`maxLength={200}`), the `CompanySelect`, title "Editar brand", `useUpdateBrand(brand.id)`, props `brand: { id: string; name: string; companyId: string | null }`, `onSaved: (brand: BrandDto) => void`, initial values `{ name: brand.name, companyId: brand.companyId }`.

`src/components/crm/crm-opportunities-table.tsx`:
```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProposalStatusBadge } from "@/components/proposals/proposal-status-badge";
import { STAGE_LABELS } from "@/lib/opportunity-stages";
import { formatCurrencyBRL } from "@/lib/format";
import type { CrmOpportunityDto } from "@/hooks/use-crm";

const STATUS_LABEL: Record<CrmOpportunityDto["status"], string> = { OPEN: "Aberta", WON: "Ganha", LOST: "Perdida" };

export function CrmOpportunitiesTable({ opportunities }: { opportunities: CrmOpportunityDto[] }) {
  if (opportunities.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma oportunidade.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Brand</TableHead>
          <TableHead>Creator</TableHead>
          <TableHead>Estágio</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Valor estimado</TableHead>
          <TableHead>Propostas</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {opportunities.map((opportunity) => (
          <TableRow key={opportunity.id}>
            <TableCell>{opportunity.brandName ?? "—"}</TableCell>
            <TableCell>{opportunity.creatorName}</TableCell>
            <TableCell>{STAGE_LABELS[opportunity.stage]}</TableCell>
            <TableCell>
              <Badge>{STATUS_LABEL[opportunity.status]}</Badge>
            </TableCell>
            <TableCell>{opportunity.estimatedValueCents === null ? "—" : formatCurrencyBRL(opportunity.estimatedValueCents)}</TableCell>
            <TableCell>
              {opportunity.proposals.length === 0 ? (
                "—"
              ) : (
                <ul className="flex flex-col gap-1">
                  {opportunity.proposals.map((proposal) => (
                    <li key={proposal.id} className="flex items-center gap-2">
                      <Link href={`/proposals/${proposal.id}`} className="underline-offset-2 hover:underline">
                        {proposal.title}
                      </Link>
                      <ProposalStatusBadge status={proposal.status} />
                    </li>
                  ))}
                </ul>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run src/components/crm`

- [ ] **Step 5: Commit**

```bash
git add src/components/crm
git commit -m "feat(crm): company/contact/brand edit dialogs and opportunities table"
```

---

### Task 7: `/companies` and `/companies/[id]` pages

**Files:**
- Create: `src/app/(app)/companies/page.tsx`, `src/app/(app)/companies/[id]/page.tsx`
- Test: `src/app/(app)/companies/page.test.tsx`, `src/app/(app)/companies/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `useCompanies`, `useBrands`, `useCompany` (Task 5); `CompanyFormDialog`, `BrandFormDialog`, `CrmOpportunitiesTable` (Task 6); `matchesSearch` (Task 1); `useIsCreator` (`@/components/shell/session-role-context`); `EmptyState`, `Table*`, `Button`, `Input`; `ApiError`.

- [ ] **Step 1: Write the failing tests**

`src/app/(app)/companies/page.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const replace = vi.fn();
let isCreator = false;
let companies: unknown[] | undefined = [];
let brands: unknown[] | undefined = [];
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("@/components/shell/session-role-context", () => ({ useIsCreator: () => isCreator }));
vi.mock("@/hooks/use-crm", () => ({
  useCompanies: () => ({ data: companies, isLoading: false, isError: false, refetch: vi.fn() }),
  useBrands: () => ({ data: brands }),
}));
vi.mock("@/components/crm/brand-form-dialog", () => ({
  BrandFormDialog: ({ open, brand }: { open: boolean; brand: { name: string } }) => (open ? <div>dialog-{brand.name}</div> : null),
}));

import CompaniesPage from "./page";

const bella = { id: "c1", name: "Bella Cosméticos", createdAt: "2026-10-01T12:00:00.000Z", brandCount: 2, contactCount: 1, openOpportunityCount: 3 };
const acme = { id: "c2", name: "Acme", createdAt: "2026-10-02T12:00:00.000Z", brandCount: 0, contactCount: 0, openOpportunityCount: 0 };

describe("CompaniesPage", () => {
  beforeEach(() => {
    isCreator = false;
    companies = [bella, acme];
    brands = [];
    push.mockReset();
    replace.mockReset();
  });

  it("lists companies with counts and filters by accent-insensitive search", async () => {
    render(<CompaniesPage />);
    expect(screen.getByText("Bella Cosméticos")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar empresa" }), "cosmeticos");
    expect(screen.queryByText("Acme")).toBeNull();
    expect(screen.getByText("Bella Cosméticos")).toBeTruthy();
  });

  it("navigates to the detail on row click", async () => {
    render(<CompaniesPage />);
    await userEvent.click(screen.getByText("Bella Cosméticos"));
    expect(push).toHaveBeenCalledWith("/companies/c1");
  });

  it("shows the empty state pointing to the inbox", () => {
    companies = [];
    render(<CompaniesPage />);
    expect(screen.getByText("Nenhuma empresa ainda")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ir para o Inbox" }).getAttribute("href")).toBe("/inbox");
  });

  it("hides the brands-without-company block when there are none", () => {
    render(<CompaniesPage />);
    expect(screen.queryByText("Brands sem empresa")).toBeNull();
  });

  it("shows brands without company and opens the brand dialog", async () => {
    brands = [{ id: "b1", name: "Sem Dono", companyId: null }, { id: "b2", name: "Linha", companyId: "c1" }];
    render(<CompaniesPage />);
    expect(screen.getByText("Brands sem empresa")).toBeTruthy();
    expect(screen.queryByText("Linha")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Vincular Sem Dono" }));
    expect(screen.getByText("dialog-Sem Dono")).toBeTruthy();
  });

  it("redirects a creator to the pipeline", () => {
    isCreator = true;
    render(<CompaniesPage />);
    expect(replace).toHaveBeenCalledWith("/pipeline");
  });
});
```

`src/app/(app)/companies/[id]/page.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const replace = vi.fn();
const toastSuccess = vi.fn();
let state: { data?: unknown; isLoading: boolean; error: unknown } = { isLoading: false, error: null };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock("@/components/shell/session-role-context", () => ({ useIsCreator: () => false }));
vi.mock("@/hooks/use-crm", () => ({ useCompany: () => ({ ...state, refetch: vi.fn() }) }));
vi.mock("@/components/crm/company-form-dialog", () => ({
  CompanyFormDialog: ({ open, onSaved }: { open: boolean; onSaved: (c: unknown) => void }) =>
    open ? (
      <button type="button" onClick={() => onSaved({ id: "c1", name: "Nova" })}>
        fake-save-company
      </button>
    ) : null,
}));
vi.mock("@/components/crm/brand-form-dialog", () => ({ BrandFormDialog: () => null }));
vi.mock("@/components/crm/crm-opportunities-table", () => ({
  CrmOpportunitiesTable: ({ opportunities }: { opportunities: unknown[] }) => <div>opps-{opportunities.length}</div>,
}));

import CompanyPage from "./page";

const detail = {
  company: { id: "c1", name: "Bella Cosméticos", createdAt: "2026-10-01T00:00:00.000Z" },
  brands: [{ id: "b1", name: "Linha Verão" }],
  contacts: [{ id: "p1", fullName: "Maria", email: "m@x.com", phone: null, instagramHandle: null }],
  opportunities: [{ id: "o1" }],
};

async function renderPage() {
  await act(async () => {
    render(
      <React.Suspense fallback={null}>
        <CompanyPage params={Promise.resolve({ id: "c1" })} />
      </React.Suspense>,
    );
  });
}

describe("CompanyPage", () => {
  beforeEach(() => {
    state = { data: detail, isLoading: false, error: null };
    toastSuccess.mockReset();
  });

  it("shows the company with brands, contacts (linked) and opportunities", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Bella Cosméticos" })).toBeTruthy();
    expect(screen.getByText("Linha Verão")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Maria" }).getAttribute("href")).toBe("/contacts/p1");
    expect(screen.getByText("opps-1")).toBeTruthy();
  });

  it("edits the company and toasts", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Editar empresa" }));
    await userEvent.click(screen.getByRole("button", { name: "fake-save-company" }));
    expect(toastSuccess).toHaveBeenCalledWith("Empresa atualizada.");
  });

  it("shows not found for a 404", async () => {
    state = { data: undefined, isLoading: false, error: new ApiError(404, "Empresa não encontrada.") };
    await renderPage();
    expect(screen.getByText("Empresa não encontrada.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voltar para Empresas" }).getAttribute("href")).toBe("/companies");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run "src/app/(app)/companies"`

- [ ] **Step 3: Implement**

`src/app/(app)/companies/page.tsx`:
```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsCreator } from "@/components/shell/session-role-context";
import { BrandFormDialog } from "@/components/crm/brand-form-dialog";
import { useBrands, useCompanies, type BrandDto } from "@/hooks/use-crm";
import { matchesSearch } from "@/lib/crm/search";

const dateLabel = (iso: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));

export default function CompaniesPage() {
  const router = useRouter();
  const isCreator = useIsCreator();
  const { data: companies, isLoading, isError, refetch } = useCompanies();
  const { data: brands } = useBrands();
  const [query, setQuery] = React.useState("");
  const [dialog, setDialog] = React.useState<{ brand: BrandDto | null; key: number }>({ brand: null, key: 0 });

  React.useEffect(() => {
    if (isCreator) router.replace("/pipeline");
  }, [isCreator, router]);
  if (isCreator) return null;

  const orphanBrands = (brands ?? []).filter((brand) => brand.companyId === null);
  const visible = (companies ?? []).filter((company) => matchesSearch(query, company.name));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Empresas</h1>
      {orphanBrands.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-md border border-border p-3">
          <h2 className="text-sm font-medium">Brands sem empresa</h2>
          <ul className="flex flex-wrap gap-2">
            {orphanBrands.map((brand) => (
              <li key={brand.id} className="flex items-center gap-2 text-sm">
                {brand.name}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Vincular ${brand.name}`}
                  onClick={() => setDialog((prev) => ({ brand, key: prev.key + 1 }))}
                >
                  Vincular
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">Não foi possível carregar as empresas.</p>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : !companies || companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhuma empresa ainda"
          description="Empresas são criadas ao converter mensagens do Inbox."
          action={
            <Link href="/inbox" className="text-sm underline">
              Ir para o Inbox
            </Link>
          }
        />
      ) : (
        <>
          <Input
            type="search"
            aria-label="Buscar empresa"
            placeholder="Buscar empresa"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-sm"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Brands</TableHead>
                <TableHead>Contatos</TableHead>
                <TableHead>Oportunidades abertas</TableHead>
                <TableHead>Criada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((company) => (
                <TableRow key={company.id} className="cursor-pointer" onClick={() => router.push(`/companies/${company.id}`)}>
                  <TableCell>
                    <Link
                      href={`/companies/${company.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        router.push(`/companies/${company.id}`);
                      }}
                    >
                      {company.name}
                    </Link>
                  </TableCell>
                  <TableCell>{company.brandCount}</TableCell>
                  <TableCell>{company.contactCount}</TableCell>
                  <TableCell>{company.openOpportunityCount}</TableCell>
                  <TableCell>{dateLabel(company.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {visible.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma empresa encontrada.</p> : null}
        </>
      )}
      {dialog.brand ? (
        <BrandFormDialog
          key={dialog.key}
          open
          brand={dialog.brand}
          onOpenChange={(open) => !open && setDialog((prev) => ({ ...prev, brand: null }))}
          onSaved={() => {
            setDialog((prev) => ({ ...prev, brand: null }));
            toast.success("Brand atualizada.");
          }}
        />
      ) : null}
    </div>
  );
}
```
The name cell is a real `<Link>` (keyboard/middle-click friendly); its `onClick` prevents default and pushes, so the row click and the link click do the same thing once.

`src/app/(app)/companies/[id]/page.tsx`:
```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsCreator } from "@/components/shell/session-role-context";
import { CompanyFormDialog } from "@/components/crm/company-form-dialog";
import { BrandFormDialog } from "@/components/crm/brand-form-dialog";
import { CrmOpportunitiesTable } from "@/components/crm/crm-opportunities-table";
import { useCompany } from "@/hooks/use-crm";
import { ApiError } from "@/lib/api-client";

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const router = useRouter();
  const isCreator = useIsCreator();
  const { data, isLoading, error, refetch } = useCompany(id);
  const [editingCompany, setEditingCompany] = React.useState(false);
  const [editingBrand, setEditingBrand] = React.useState<{ id: string; name: string } | null>(null);

  React.useEffect(() => {
    if (isCreator) router.replace("/pipeline");
  }, [isCreator, router]);
  if (isCreator) return null;

  const back = (
    <Link href="/companies" className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Voltar para Empresas">
      <ArrowLeft className="size-4" /> Empresas
    </Link>
  );

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm">Empresa não encontrada.</p>
        {back}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">Não foi possível carregar a empresa.</p>
        <Button type="button" variant="outline" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {back}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{data.company.name}</h1>
        <Button type="button" variant="outline" aria-label="Editar empresa" onClick={() => setEditingCompany(true)}>
          Editar
        </Button>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Brands</h2>
        {data.brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma brand.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.brands.map((brand) => (
              <li key={brand.id} className="flex items-center gap-2 text-sm">
                {brand.name}
                <Button type="button" variant="outline" size="sm" aria-label={`Editar ${brand.name}`} onClick={() => setEditingBrand(brand)}>
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Contatos</h2>
        {data.contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum contato.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Instagram</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <Link href={`/contacts/${contact.id}`}>{contact.fullName}</Link>
                  </TableCell>
                  <TableCell>{contact.email ?? "—"}</TableCell>
                  <TableCell>{contact.phone ?? "—"}</TableCell>
                  <TableCell>{contact.instagramHandle ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Oportunidades</h2>
        <CrmOpportunitiesTable opportunities={data.opportunities} />
      </section>

      {editingCompany ? (
        <CompanyFormDialog
          open
          company={data.company}
          onOpenChange={setEditingCompany}
          onSaved={() => {
            setEditingCompany(false);
            toast.success("Empresa atualizada.");
          }}
        />
      ) : null}
      {editingBrand ? (
        <BrandFormDialog
          open
          brand={{ ...editingBrand, companyId: data.company.id }}
          onOpenChange={(open) => !open && setEditingBrand(null)}
          onSaved={() => {
            setEditingBrand(null);
            toast.success("Brand atualizada.");
          }}
        />
      ) : null}
    </div>
  );
}
```
The "Editar empresa" test finds the button by its `aria-label`. The 404 test finds the back link by `aria-label="Voltar para Empresas"`.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run "src/app/(app)/companies"`

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/companies"
git commit -m "feat(crm): /companies list and /companies/[id] detail pages"
```

---

### Task 8: `/contacts` and `/contacts/[id]` pages

**Files:**
- Create: `src/app/(app)/contacts/page.tsx`, `src/app/(app)/contacts/[id]/page.tsx`
- Test: `src/app/(app)/contacts/page.test.tsx`, `src/app/(app)/contacts/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `useContacts`, `useContact` (Task 5); `ContactFormDialog`, `CrmOpportunitiesTable` (Task 6); `matchesSearch` (Task 1).

- [ ] **Step 1: Write the failing tests**

`src/app/(app)/contacts/page.test.tsx` — mirror the companies list test with:
- data `[{ id: "p1", fullName: "Maria Fernandes", email: "maria@bella.com", phone: "48 9999", instagramHandle: "@maria.f", companyId: "c1", companyName: "Bella", createdAt: "..." }, { id: "p2", fullName: "João", email: null, phone: null, instagramHandle: null, companyId: null, companyName: null, createdAt: "..." }]`;
- search box `{ name: "Buscar contato" }`: typing `"@maria"` hides João; typing `"bella.com"` keeps Maria (e-mail match);
- row click → `push("/contacts/p1")`;
- empty state title "Nenhum contato ainda" with link "Ir para o Inbox" → `/inbox`;
- creator redirect → `replace("/pipeline")`.
Mock `@/hooks/use-crm` with `useContacts` only.

`src/app/(app)/contacts/[id]/page.test.tsx` — mirror the company detail test with:
- detail `{ contact: { id: "p1", fullName: "Maria", email: "m@x.com", phone: null, instagramHandle: null, companyId: "c1", createdAt: "..." }, company: { id: "c1", name: "Bella" }, opportunities: [{ id: "o1" }] }`;
- heading "Maria"; link "Bella" → `/companies/c1`; `opps-1`;
- "Editar contato" → fake dialog save → `toastSuccess("Contato atualizado.")`;
- 404 → "Contato não encontrado." + link `aria-label="Voltar para Contatos"` → `/contacts`.
Mock `@/components/crm/contact-form-dialog` (`ContactFormDialog`) and `@/components/crm/crm-opportunities-table` like the company test.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run "src/app/(app)/contacts"`

- [ ] **Step 3: Implement**

`src/app/(app)/contacts/page.tsx`:
```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { Contact } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsCreator } from "@/components/shell/session-role-context";
import { useContacts } from "@/hooks/use-crm";
import { matchesSearch } from "@/lib/crm/search";

export default function ContactsPage() {
  const router = useRouter();
  const isCreator = useIsCreator();
  const { data: contacts, isLoading, isError, refetch } = useContacts();
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (isCreator) router.replace("/pipeline");
  }, [isCreator, router]);
  if (isCreator) return null;

  const visible = (contacts ?? []).filter((contact) => matchesSearch(query, contact.fullName, contact.email, contact.instagramHandle));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Contatos</h1>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">Não foi possível carregar os contatos.</p>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : !contacts || contacts.length === 0 ? (
        <EmptyState
          icon={Contact}
          title="Nenhum contato ainda"
          description="Contatos são criados ao converter mensagens do Inbox."
          action={
            <Link href="/inbox" className="text-sm underline">
              Ir para o Inbox
            </Link>
          }
        />
      ) : (
        <>
          <Input
            type="search"
            aria-label="Buscar contato"
            placeholder="Buscar por nome, e-mail ou Instagram"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-sm"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Instagram</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((contact) => (
                <TableRow key={contact.id} className="cursor-pointer" onClick={() => router.push(`/contacts/${contact.id}`)}>
                  <TableCell>
                    <Link
                      href={`/contacts/${contact.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        router.push(`/contacts/${contact.id}`);
                      }}
                    >
                      {contact.fullName}
                    </Link>
                  </TableCell>
                  <TableCell>{contact.companyName ?? "—"}</TableCell>
                  <TableCell>{contact.email ?? "—"}</TableCell>
                  <TableCell>{contact.phone ?? "—"}</TableCell>
                  <TableCell>{contact.instagramHandle ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {visible.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum contato encontrado.</p> : null}
        </>
      )}
    </div>
  );
}
```

`src/app/(app)/contacts/[id]/page.tsx`: same structure as the company detail page:
- `useContact(id)`; back link `href="/contacts"` with `aria-label="Voltar para Contatos"` and text "Contatos";
- 404 text "Contato não encontrado."; generic error "Não foi possível carregar o contato." + "Tentar novamente";
- header: `<h1>{data.contact.fullName}</h1>`, below it the company as `<Link href={`/companies/${data.company.id}`}>{data.company.name}</Link>` or "Sem empresa"; e-mail, telefone, Instagram as a small definition list (`—` for null);
- button "Editar" with `aria-label="Editar contato"` → `<ContactFormDialog open contact={data.contact} ... onSaved={() => { close; toast.success("Contato atualizado."); }} />`;
- section "Oportunidades" → `<CrmOpportunitiesTable opportunities={data.opportunities} />`.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run "src/app/(app)/contacts"`

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/contacts"
git commit -m "feat(crm): /contacts list and /contacts/[id] detail pages"
```

---

### Task 9: Full verification (controller, not a subagent)

- [ ] **Step 1:** `pnpm exec next typegen && pnpm tsc --noEmit` — expect no errors.
- [ ] **Step 2:** `pnpm lint` — no new errors in touched files.
- [ ] **Step 3:** `pnpm vitest run --testTimeout=60000 --hookTimeout=60000` — whole suite green (only one vitest process).
- [ ] **Step 4:** `OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test pnpm build` — build passes.
- [ ] **Step 5:** Manual browser check (user logs in on the browser pane; controller drives): `/companies` list + search, "Brands sem empresa" → Vincular, `/companies/[id]` → edit name (try a duplicate name → message under the field), edit a brand, open a contact → `/contacts/[id]` → edit contact (invalid e-mail → field error) → `/contacts` search. Confirm the inbox company selector shows a renamed company.
- [ ] **Step 6:** Update `TAREFA.md` checkboxes, commit.
