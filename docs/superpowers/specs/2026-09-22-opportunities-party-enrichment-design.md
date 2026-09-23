# PublyFlow — Opportunities Party Enrichment Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Inbox screen (merged) — reuses the same enrichment pattern established for
Commercial Inquiries.
Blocks: Pipeline UX Spec (a Kanban card needs to show who the deal is with, not raw UUIDs).

## 1. Contexto

`GET /api/opportunities` (`OpportunitiesRepository.listByCreator`) returns raw `Opportunity`
rows: `companyId`/`brandId` (nullable UUIDs, no name) and `leadId` (no join to the lead's
contact). A Kanban card is fundamentally about "who is this deal with" — the same gap already
identified and closed for Commercial Inquiries via message enrichment.

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Onde enriquecer | `OpportunitiesRepository.listByCreator` gains `LEFT JOIN`s to `companies` (via `opportunities.companyId`, nullable) and `brands` (via `opportunities.brandId`, nullable), and `INNER JOIN`s to `leads` (via `opportunities.leadId`, `NOT NULL`) and `contacts` (via `leads.contactId`, `NOT NULL`) — returning a new `OpportunityWithParties` type instead of the bare `Opportunity` row. |
| 2 | Campos adicionados | `companyName: string \| null` (null when `companyId` is null), `brandName: string \| null` (null when `brandId` is null), `contactName: string` (always present — `leads.contactId` is `NOT NULL`), `leadId` (already present on the base row, kept for reference). |
| 3 | Join safety | `companies`/`brands` joins are `LEFT JOIN` because `opportunities.companyId`/`brandId` are nullable — an `INNER JOIN` would silently drop opportunities with no company/brand. `leads`/`contacts` joins are `INNER JOIN` because both FKs are `NOT NULL` (`opportunities.leadId references leads.id` and `leads.contactId references contacts.id`, neither nullable) — cannot silently drop a row. |
| 4 | Camada de serviço | `OpportunityService.listByCreator`'s return type updates to `OpportunityWithParties[]` — thin wrapper, no logic change. |
| 5 | API HTTP | `GET /api/opportunities` response shape gains the three new fields per row. No new route, no new query parameter. |

**Fora de escopo:** `GET /api/opportunities/:id` detail route (unmodified, not enriched — no
screen has asked for a standalone detail fetch yet); any enrichment beyond what a Kanban card
needs (no full lead/inquiry history, no proposal data); `PATCH /api/opportunities/:id` stays
unmodified (already returns 200 with the bare `Opportunity` row, which is sufficient for a
stage-change confirmation — the calling UI already has the enriched row from the list).

## 3. Escopo de Implementação

- New type `OpportunityWithParties` in `src/repositories/opportunities.repository.ts`.
- `OpportunitiesRepository.listByCreator` rewritten to join and select the extra fields, same
  signature (`db, organizationId, creatorId, stage?`), same ordering (`createdAt desc`), same
  optional stage filter.
- `OpportunityService.listByCreator`'s return type updated to match.
- No route file changes needed — `GET /api/opportunities` already returns whatever the service
  returns unmodified.
- Tests: extend the existing `listByCreator` repository test to assert the three new fields;
  extend the existing route test to assert the response JSON includes them; add a case proving
  a `null` companyId/brandId doesn't drop the opportunity row (LEFT JOIN safety).

## 4. Próximo Passo

Gerar o plano de implementação via `writing-plans`. Depois de mergeado, seguir para a UX Spec
do Pipeline.
