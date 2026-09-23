# PublyFlow — Brands List API Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Companies List API pattern (already merged, `src/app/api/companies/route.ts`).
Blocks: the Inbox screen's edit-mode Brand Combobox (needs a way to list brands for
selection when a brand-name guess is ambiguous).

## 1. Contexto

`BrandsRepository` only has `listByName` (exact-match, used by `resolvePartyIdFromGuess`) and
`create` (used server-side during `CommercialInquiryService.resolve`'s guess-resolution). There
is no `GET /api/brands` — no way for the frontend to list an organization's brands at all. The
Inbox's edit-mode form needs this to let the assessora pick the correct brand when a brand-name
guess matches more than one existing row (the same `AmbiguousPartyGuessError`/422 mechanism
already built for companies).

## 2. Decisão de Design

Mirror `GET /api/companies` exactly: `BrandsRepository` gains `listByOrganization`, a new thin
`BrandService` wraps it, and `GET /api/brands?organizationId=` exposes it. Same shape, same
conventions, same scope discipline (no detail route, no CRUD beyond listing, no pagination) as
every other list API in this project.

**Fora de escopo:** `GET /api/brands/:id`, `POST /api/brands` (brand creation stays a
server-side-only concern via the existing guess-resolution path — no UI creates a brand
directly), pagination, any change to `BrandsRepository.listByName`/`create`.

## 3. Escopo de Implementação

- `BrandsRepository.listByOrganization(db, organizationId): Promise<Brand[]>`, ordered by
  `createdAt desc` — same pattern as `CompaniesRepository.listByOrganization`.
- New `BrandService` (`src/services/brand.service.ts`) with `listByOrganization`.
- New `src/app/api/brands/route.ts` with `GET`.
- Tests: repository (lists by org, empty org), route (200 with the org's brands).

## 4. Próximo Passo

Gerar o plano de implementação via `writing-plans`. Depois de mergeado, retomar a fix wave do
Inbox screen (achado #3).
