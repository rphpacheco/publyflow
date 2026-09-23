# PublyFlow — Ambiguous Party Guess Detection Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Mark False Positive Route — merged to `main`.
Blocks: Inbox UX Spec's 1-click convert flow.

## 1. Contexto

`CommercialInquiryService.resolve` (used by `POST /api/commercial-inquiries/[id]/convert`)
resolves `companyGuess`/`brandGuess` into real `companies`/`brands` rows via
`resolvePartyIdFromGuess`: an exact-name `findByName` lookup, reusing the row if found,
creating one if not. Neither `companies.name` nor `brands.name` has a uniqueness constraint,
so if an organization already has two rows with the exact same name, `findByName`'s
`SELECT ... LIMIT` (implicit via array destructuring) silently returns whichever one Postgres
happens to return first — the 1-click convert path in the Inbox UX would then silently link
the inquiry to a possibly-wrong company/brand with no way for the assessora to notice.

This does not attempt to solve near-duplicate detection (typos, name variants) — that needs
fuzzy matching, an undesigned, materially larger feature. This spec only closes the exact-match
ambiguity gap: when more than one row shares the exact guessed name, refuse to silently pick
one.

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Detecção de ambiguidade | `CompaniesRepository`/`BrandsRepository` gain `listByName(db, organizationId, name): Promise<Company[]>`/`Promise<Brand[]>` (replacing `findByName`, which has exactly one caller — `resolvePartyIdFromGuess` — and would otherwise become dead code alongside it). Returns ALL exact-name matches, not just the first. |
| 2 | Resolução em `resolvePartyIdFromGuess` | 0 matches → create (unchanged). Exactly 1 match → reuse it (unchanged). **More than 1 match → throw a new `AmbiguousPartyGuessError`** instead of picking one arbitrarily. |
| 3 | Novo erro de domínio | `AmbiguousPartyGuessError` in `src/domain/commercial-flow/errors.ts` (same file as the other `CommercialInquiryService.resolve` errors), carrying the ambiguous guess string. |
| 4 | Mapeamento HTTP | `POST /api/commercial-inquiries/[id]/convert`'s route currently has NO error mapping at all (an existing, separately-registered gap — same class of debt as `discard`'s). Since this mini-cycle's whole purpose is letting the frontend distinguish "ambiguous, needs manual resolution" from other failures, the route gains proper mapping: `InquiryNotFoundError` → `404`, `InquiryAlreadyResolvedError` → `409`, `AmbiguousPartyGuessError` → `422` (distinct code so the Inbox's 1-click flow can specifically catch it and fall back to the edit/combobox mode with a clear message, without needing a custom response-body field to distinguish it from a plain conflict). |

**Fora de escopo:** near-duplicate/fuzzy matching; adding a uniqueness constraint to
`companies.name`/`brands.name` (a schema/data-integrity decision independent of this fix, not
requested); any UI (the Inbox spec's edit/combobox flow consumes this, but isn't built here).

## 3. Escopo de Implementação

- `CompaniesRepository`/`BrandsRepository`: replace `findByName` with `listByName` (same
  signature shape, returns an array).
- `src/domain/commercial-flow/errors.ts`: add `AmbiguousPartyGuessError`.
- `src/services/commercial-inquiry.service.ts`: `resolvePartyIdFromGuess` checks match count
  and throws on >1.
- `src/app/api/commercial-inquiries/[id]/convert/route.ts`: add `try`/`catch` mapping the
  three errors as described in Decisão #4.
- Tests: repository (`listByName` returns all matches), service (`resolve` throws
  `AmbiguousPartyGuessError` when two companies share a guessed name), route (422 case).

## 4. Próximo Passo

Gerar o plano de implementação via `writing-plans`. Depois de mergeado, retomar e fechar a
spec de UX do Inbox (Bloco 2 pode ser aprovado com a frase corrigida).
