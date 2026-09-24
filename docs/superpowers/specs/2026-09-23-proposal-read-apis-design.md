# PublyFlow — Proposal Read APIs Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Proposals core domain (merged) — reuses its schema, repositories, and error types.
Blocks: Proposal Builder UX Spec (`/proposals/[id]` needs to load a proposal plus its items and
blocks on open — none of these three reads exist today).

## 1. Contexto

The Proposals core domain (`proposals`, `proposal_items`, `proposal_blocks`, `proposal_versions`)
was built with full write support (`POST`/`PATCH`/`DELETE` across all four tables) but only one
read path: `GET /api/proposals?organizationId=&opportunityId=` (list proposals for an
Opportunity). There is no way to fetch a single proposal by id, nor to list its items or blocks —
a genuine gap surfaced while brainstorming the Proposal Builder UX, which needs exactly these
three reads to render `/proposals/[id]` on load (page refresh, direct navigation, or arriving
from the Pipeline Side Panel's proposal list).

This mirrors the `GET /api/opportunities/:id` pattern already established and merged.

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | `GET /api/proposals/:id?organizationId=` | Mirrors `GET /api/opportunities/:id` exactly: `organizationId` required as a query param, `404` via `ProposalNotFoundError` if no row matches. Requires a new `ProposalService.findById` (only the repository has this today) — a thin pass-through, no new logic. |
| 2 | `GET /api/proposals/:id/items?organizationId=` | Returns `ProposalItem[]` in whatever order `ProposalItemsRepository.listByProposal` already returns. Requires a new `ProposalItemService.listByProposal` — thin pass-through; the repository method already exists. No 404 on an empty list — an existing proposal with zero items returns `[]`, `200`. |
| 3 | `GET /api/proposals/:id/blocks?organizationId=` | Returns `ProposalBlock[]`, same shape of change as #2 — new `ProposalBlockService.listByProposal` thin pass-through, repository method already exists. |
| 4 | No enrichment | These reads return the bare rows exactly as stored (including `rateCardItemId`/`blockType` as raw values) — no joins, no derived display fields. The Proposal Builder UX already has everything else it needs (creator/company/contact names) via the Opportunity it's already loaded contextually; if the builder later needs something these reads don't carry, that becomes a small follow-up, not something to guess at now. |
| 5 | No new write routes | This cycle is read-only. `POST`/`PATCH`/`DELETE` on proposals/items/blocks are unchanged. |

**Fora de escopo:** pagination (no list in this codebase paginates); enrichment/joins of any
kind; the `GET /api/proposals/:id/versions` route (already exists, untouched); any change to
`ProposalItemService.addItem`/`updateItem`/`removeItem` or their block equivalents.

## 3. Próximo Passo

Gerar o plano de implementação via `writing-plans`. Depois de mergeado, retomar o brainstorm da
UX Spec do Proposal Builder.
