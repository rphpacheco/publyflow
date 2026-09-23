# PublyFlow — Mark False Positive Route Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Commercial Inquiries Message Enrichment — merged to `main`.
Blocks: Inbox UX Spec (needs all three inquiry-resolution actions — Converter/Descartar/Falso
Positivo — backed by real routes before being designed as distinct UI actions).

## 1. Contexto

`CommercialInquiryService.markFalsePositive` already exists (sets `status: "FALSE_POSITIVE"`,
guarded against acting on an already-terminal inquiry) but has no HTTP route — only
`discard` (→ `POST /api/commercial-inquiries/[id]/discard`) and `resolve` (→
`POST /api/commercial-inquiries/[id]/convert`) do. The Inbox needs all three as distinct
actions: **Converter** (commercial, proceed to Lead/Opportunity), **Descartar** (commercial or
not, assessora chooses not to proceed), **Falso Positivo** (the AI's classification was wrong
— tracks classification quality, distinct from a proceed/don't-proceed business decision).

## 2. Decisão de Design

Add `POST /api/commercial-inquiries/[id]/mark-false-positive`, mirroring the `discard` route's
request/response shape (`{organizationId}` body, `204` no content on success). No new domain
logic, no new abstraction — `CommercialInquiryService.markFalsePositive` already has
everything the route needs.

**Correção em relação ao padrão do `discard`:** `discard`'s current route does NOT map
`InquiryNotFoundError`/`InquiryAlreadyResolvedError` to HTTP status codes — any domain error
there surfaces as an unmapped `500`. That's a known, already-registered debt item from the
backend audit ("mapeamento completo dos erros antigos do Milestone 2... sem try/catch"),
explicitly deferred rather than fixed in that wave. This new route does NOT copy that gap: it
maps `InquiryNotFoundError` → `404` and `InquiryAlreadyResolvedError` → `409`, following the
`instanceof`-based mapping pattern already used by newer routes in this codebase (e.g.
`src/app/api/opportunities/[id]/route.ts`'s `PATCH` handler). This is new code, not a
retrofit of `discard`, so it follows the current best-practice pattern rather than propagating
an old one — `discard`'s own error-mapping gap is untouched and stays exactly where the audit
left it.

**Fora de escopo:** no change to `discard`'s or `convert`'s existing behavior (including their
error-mapping gap); no UI.

## 3. Escopo de Implementação

- New `src/app/api/commercial-inquiries/[id]/mark-false-positive/route.ts`, with
  `InquiryNotFoundError` → `404` and `InquiryAlreadyResolvedError` → `409` error mapping.
- Route test covering the success case (`204`), the not-found case (`404`), and the
  already-resolved case (`409`) — `discard`'s route currently has no dedicated test file to
  reuse, so this one is written from the `instanceof`-mapping pattern already established
  elsewhere (`src/app/api/opportunities/[id]/route.ts`).

## 4. Próximo Passo

Gerar o plano de implementação via `writing-plans`. Depois de mergeado, seguir para a UX Spec
do Inbox.
