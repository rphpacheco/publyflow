# Companies & Contacts pages (CRM read + edit)

Date: 2026-10-04. Status: approved design (user, 2026-10-04), pending written-spec review.
Origin: sidebar links `/companies` and `/contacts` return 404. `/dashboard` (also 404) is a separate spec; merging duplicates is a separate spec too (see TAREFA.md 1b/1c).

## 1. Decisions

| # | Decision |
|---|---|
| D1 | Companies and Contacts ship together in one spec. |
| D2 | Scope = **read + edit**: list with search, detail page with relations, edit dialog. Records are still created only by inbox conversion. No create, no delete. |
| D3 | Brands live inside the company detail: list, rename, move to another company or to none. No `/brands` page. Brands without a company are shown in a "Brands sem empresa" block on `/companies`. |
| D4 | Merging duplicates is out of scope (own spec later). |
| D5 | Layout = list page + detail route (`/companies/[id]`, `/contacts/[id]`), edit via dialog (same pattern as `creator-form-dialog`). |
| D6 | Renaming a company to a name another company of the org already has (case-insensitive, trimmed) is refused with 409. Reason: inbox conversion finds companies by exact name, and duplicates make that ambiguous (`AmbiguousPartyGuessError`). Contacts and brands have no name-uniqueness rule. |
| D7 | Access: OWNER/MANAGER only (unchanged for the existing GETs). CREATOR → 403 on the API; the pages redirect a creator to `/pipeline` and the sidebar already hides the links. |
| D8 | Search is client-side over the full list (agencies have tens to hundreds of records). No server pagination in this version. |
| D9 | No migration. Name comparison uses `lower(trim(name))` in the query, no new index. |

## 2. Server

All queries and joins carry an explicit `organization_id` predicate and run inside `runInTenantContext`. Layering: route → service → repository. Domain errors in a new `src/domain/crm/errors.ts`:
`CompanyNotFoundError`, `ContactNotFoundError`, `BrandNotFoundError`, `CompanyNameTakenError`, `CompanyRefNotFoundError` (a `companyId` in a body that doesn't exist in the org).

### 2.1 Lists (existing routes, additive fields only)
- `GET /api/companies` → each item gains `brandCount`, `contactCount`, `openOpportunityCount` (opportunities with `status = 'OPEN'`). Existing fields (`id`, `name`, `organizationId`, `createdAt`) stay, so `use-party-options` keeps working.
- `GET /api/contacts` → each item gains `companyName: string | null`.
- `GET /api/brands` unchanged (already returns `companyId`); the "Brands sem empresa" block filters `companyId === null` client-side.

### 2.2 Details
- `GET /api/companies/[id]` → `{ company, brands[], contacts[], opportunities[] }`.
  - `brands`: `id, name`.
  - `contacts`: `id, fullName, email, phone, instagramHandle`.
  - `opportunities` (where `opportunities.company_id = id`): `id, brandName, creatorName, stage, status, estimatedValueCents, createdAt, proposals[] { id, title, status }`, newest first.
  - Changes the current response shape of this route; nothing in the app consumes it today (checked 2026-10-04: only its own route test).
- `GET /api/contacts/[id]` → `{ contact, company: { id, name } | null, opportunities[] }`; opportunities reached via `leads.contact_id = id` → `opportunities.lead_id`, same item shape as above.
- Both: `isUuid` guard; unknown or other-org id → 404.

### 2.3 Edits (new routes)
All: session (401) → `canManageOrganization` (CREATOR → 403) → `isUuid` (404) → zod `safeParse` (400 `{ errors: fieldErrors }`). Text fields are trimmed; max 200 chars ("Use no máximo 200 caracteres."); for nullable fields an empty string after trim is stored as `null`. At least one key required. Each route returns the updated entity.

- `PATCH /api/companies/[id]` — `{ name }` (required non-empty when present).
  - Service locks the company row (`FOR UPDATE`), checks no *other* company in the org has `lower(trim(name)) = lower(trim(:name))`, updates.
  - Known gap, accepted: two concurrent renames of different companies to the same name can both pass the check (no unique index). Duplicates already arise from conversion today; merging (D4) is the fix.
- `PATCH /api/contacts/[id]` — `{ fullName, email, phone, instagramHandle, companyId }`.
  - `fullName` non-empty when present; `email` must be a valid e-mail or null; `companyId` uuid or null.
  - A non-null `companyId` must exist in the org (`CompanyRefNotFoundError`).
- `PATCH /api/brands/[id]` — `{ name, companyId }`; same `companyId` rule.

### 2.4 Error mapping (Portuguese, `{ error, code? }`)
| Error | HTTP | Message |
|---|---|---|
| `CompanyNotFoundError` | 404 | "Empresa não encontrada." |
| `ContactNotFoundError` | 404 | "Contato não encontrado." |
| `BrandNotFoundError` | 404 | "Brand não encontrada." |
| `CompanyNameTakenError` | 409 `COMPANY_NAME_TAKEN` | "Já existe uma empresa com esse nome." |
| `CompanyRefNotFoundError` | 422 `COMPANY_NOT_FOUND` | "Empresa selecionada não encontrada." |
| Postgres 40P01 | 409 | via `src/lib/db-errors.ts` |

One mapper module for the three routes (pattern: `src/app/api/commercial-inquiries/[id]/inquiry-errors.ts`). Raw exception text never reaches the client.

### 2.5 Side effect (intended)
Renaming a company changes what future inbox conversions match by name. That is the point of the edit: fixing the name makes the next message from that company land on the right record.

## 3. UI

Pattern of `/creators`: project `Table`, `EmptyState`, form dialog, `sonner` toast, TanStack Query hooks in `src/hooks/` on `apiFetch`. Pages under `src/app/(app)/`; components under `src/components/crm/`. Data is org-wide (not filtered by the selected creator); opportunities show the creator in a column. A CREATOR who opens these URLs is redirected to `/pipeline`. Tables sit inside a horizontal-scroll container on narrow screens.

### 3.1 `/companies`
- Search input (name; case- and accent-insensitive, client-side).
- "Brands sem empresa" block above the table, only when there are any; each brand has "Vincular" → brand dialog.
- Table: **Empresa · Brands · Contatos · Oportunidades abertas · Criada em**; row click → detail.
- Empty: "Nenhuma empresa ainda. Empresas são criadas ao converter mensagens do Inbox." + link to `/inbox`.

### 3.2 `/companies/[id]`
- Header: name, "Editar" (dialog: name), "← Empresas".
- **Brands**: name + "Editar" (dialog: name, company combobox incl. "Sem empresa").
- **Contatos**: name, e-mail, telefone, Instagram; row → `/contacts/[id]`.
- **Oportunidades**: brand, creator, estágio, status, valor estimado (BRL), proposals (title + status, link to `/proposals/[id]`).
- 404 → "Empresa não encontrada." + link back.

### 3.3 `/contacts`
- Search (name, e-mail, Instagram).
- Table: **Nome · Empresa · E-mail · Telefone · Instagram**; row → detail.
- Empty state in the same style as companies.

### 3.4 `/contacts/[id]`
- Header: name, company (link), "Editar" (dialog: nome, e-mail, telefone, Instagram, company combobox incl. "Sem empresa").
- **Oportunidades** block, same columns as 3.2.
- 404 → "Contato não encontrado." + link back.

### 3.5 Shared behavior
- Save → toast "Empresa atualizada." / "Contato atualizado." / "Brand atualizada."; invalidate the affected list and detail queries (and `use-party-options` keys, so the inbox selectors see renames).
- Errors in the dialog: 409 under the name field; 400 per field; anything else → toast with `ApiError.message`.

## 4. Tests

Vitest against the real test Postgres (`withTestDb`, `src/test/helpers`).
- **Repositories/services**: list counts; detail aggregates the right relations; **org isolation** (other org's companies/contacts/brands/opportunities never appear in lists, details or joins, and their ids → not found); 409 on duplicate name (case/space variants) while renaming a company to its own name is allowed; `companyId` org check on contact and brand; empty string → null.
- **Routes**: 401, 403 (CREATOR), 404 (unknown + malformed id), 400, 409, 422, success. New PATCH routes are covered by `write-guard.test.ts` and `id-guard.test.ts` automatically.
- **Hooks/pages** (Testing Library): search filters; empty state; dialog shows 409 under the field; creator redirect; "Brands sem empresa" block appears only when needed.
- **Regression**: `use-party-options` works with the new list shape.
- **Manual browser check** (user logs in): list → detail → edit company, contact, brand; rename conflict message.

## 5. Out of scope
Create/delete companies, contacts, brands; merging duplicates; `/brands` page; server pagination; `/dashboard`; unique index on company names.
