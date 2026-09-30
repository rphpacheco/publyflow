# /proposals — proposal queue

Date: 2026-09-30. Status: approved design, pending written-spec review.
Depends on: spec 2 (sending: versions, publications, responses), spec B (CREATOR scope), spec D (creator approval, `deriveApprovalState`).

## 1. Goal

The sidebar link `/proposals` returns 404 for every role. Build the page as a **queue organized by what needs to happen next**: every proposal of the organization (or, for a CREATOR, of that creator) grouped by a server-computed *situation*.

Out of scope: creating proposals (they keep starting from the opportunity in the Pipeline), any write action on the list, pagination, search, per-column filters.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Main job = "what needs action now": groups by situation, not a flat table. |
| D2 | No proposal creation here; the empty state points to the Pipeline. |
| D3 | The situation is computed **only on the server**, reusing `computeSendFlags` (spec 2) and `deriveApprovalState` (spec D). The page only renders. |
| D4 | All closed proposals are listed (no time cut). The API also returns `closedCount` for a future "Fechadas (127) · Mostrar mais" pattern; the V1 UI does not use it. |
| D5 | Group order and labels differ by role (§5). |
| D6 | Empty groups are hidden. Archived proposals are hidden by default ("Mostrar arquivadas"). |
| D7 | CREATOR scope is applied in the endpoint; the page has no write actions for any role. |

## 3. Situations

`type QueueSituation = "changes_requested" | "ready_to_send" | "awaiting_creator" | "draft" | "awaiting_client" | "closed" | "archived"`.

Pure function `deriveQueueSituation(input)` in `src/lib/proposals/queue-situation.ts`. Inputs:
`status` (proposal status), `hasUnsentChanges` and `canSend` (from `computeSendFlags`), `approvalState` (from `deriveApprovalState`), `hasPublication` (any publication exists).

Rules, first match wins:

| # | Situation | Condition |
|---|---|---|
| 1 | `archived` | `status = ARCHIVED` |
| 2 | `changes_requested` | `approvalState = changes_requested` **and `canSend`** (creator asked for changes on the current version and there is still something to send), **or** `status = CHANGES_REQUESTED` and not `hasUnsentChanges` (client asked for changes and nothing was edited yet) |
| 3 | `ready_to_send` | `canSend` and (`approvalState = approved` or (`approvalState = not_required` and `hasPublication`)) |
| 4 | `awaiting_creator` | `canSend` and `approvalState = pending` |
| 5 | `draft` | `canSend` (covers: never sent without a pending request; approval `none` or `stale`) |
| 6 | `awaiting_client` | `status = SENT` |
| 7 | `closed` | `status ∈ {APPROVED, REJECTED}` |

After a send (with or without the creator's approval), the latest publication and its commercial status are the source of truth: an old creator change request no longer classifies the proposal (amended 2026-09-30 after final review — same meaning as the proposal page, which only shows the approval block while there is something to send). Once the agency edits after a client's change request, the proposal leaves `changes_requested` and follows rules 3–5 (the next action is to send). Rule 7 is reached only when there is nothing new to send; an edited APPROVED/REJECTED proposal falls in rules 3–5.

## 4. API — `GET /api/proposals/queue`

Query: `includeArchived=1` (optional; default excludes archived rows from `items`).

Response 200:
```ts
{
  items: QueueItem[];
  closedCount: number;   // closed items among the loaded set
  truncated: boolean;    // more than 200 proposals exist in scope
}

interface QueueItem {
  id: string;
  title: string;
  situation: QueueSituation;
  creatorName: string;            // creators.display_name
  counterpartName: string | null; // brand name ?? company name ?? null (from the opportunity)
  totalCents: number;             // sum(quantity * unit_price) of proposal_items
  lastActivityAt: string;         // ISO; max of latest version created_at, latest publication published_at, client response responded_at, latest approval requested_at / decided_at
  latestVersionNumber: number;
  latestPublication: { versionNumber: number; publishedAt: string } | null;
  changes: { by: "client" | "creator"; name: string; excerpt: string } | null; // set when situation = changes_requested; name = respondent or creator display name; excerpt via existing `excerpt()` (140 chars)
  approvedByCreator: boolean;     // approvalState = approved
  approvalStale: boolean;         // approvalState = stale
  clientOutcome: { action: "ACCEPT" | "REJECT"; name: string; at: string } | null; // set when situation = closed
}
```

Rules:
- Session required (401). OWNER/MANAGER: whole organization. CREATOR: only proposals whose opportunity's `creator_id` = `session.creatorId` (same scope rule as `proposalOutOfScope`).
- Loads at most **200** proposals of the scope ordered by `proposals.created_at desc` (archived excluded from the count unless `includeArchived=1`); `truncated = true` when a 201st exists.
- Data is read in **set-based queries** (no per-proposal round trips), all with explicit `organization_id` predicates (the app role bypasses RLS): proposals ⨝ opportunities (scope) ⨝ creators ⨝ brands/companies; latest version per proposal; latest publication per proposal ⨝ its response; latest approval request per proposal; item totals; creator access (CREATOR membership per creator user). One REPEATABLE READ transaction.
- Sorting is done in the UI by group; the API returns items sorted by `lastActivityAt desc`.
- Unknown query params are ignored; `includeArchived` accepts only `1`.

## 5. UI — `src/app/(app)/proposals/page.tsx`

Heading "Propostas". Groups render in role order; empty groups are hidden; within a group, `lastActivityAt desc`.

**OWNER / MANAGER** (label ← situation):
1. Ajustes pedidos ← `changes_requested`
2. Pronta para enviar ← `ready_to_send`
3. Aguardando creator ← `awaiting_creator`
4. Rascunho ← `draft`
5. Aguardando cliente ← `awaiting_client`
6. Fechadas ← `closed`

**CREATOR**:
1. Aguardando sua aprovação ← `awaiting_creator`
2. Em ajustes ← `changes_requested`
3. Com a agência ← `ready_to_send` + `draft`
4. Aguardando cliente ← `awaiting_client`
5. Fechadas ← `closed`

Archived (both roles): hidden; a "Mostrar arquivadas" button refetches with `includeArchived=1` and shows a last group "Arquivadas". The button then reads "Ocultar arquivadas".

Each group: heading `{label} ({count})`, then rows. Row = link to `/proposals/{id}` with: title; creator name (OWNER/MANAGER only); counterpart name (or nothing); total formatted in BRL; detail line; last activity date (dd/mm/aaaa).

Detail line by situation (agency / creator where different):

| situation | detail |
|---|---|
| changes_requested (client) | `{name} pediu: {excerpt}` |
| changes_requested (creator) | `{name} pediu: {excerpt}` / creator: `Você pediu: {excerpt}` |
| ready_to_send | `Aprovada por {creatorName}` if approvedByCreator, else `Alterações não enviadas · versão {latestVersionNumber}` |
| awaiting_creator | `Versão {n} aguardando aprovação` / creator: `Versão {n} aguardando sua aprovação` |
| draft | `A proposta mudou depois do pedido de aprovação` if approvalStale; else `Alterações não enviadas · versão {n}` if latestPublication; else `Ainda não enviada` |
| awaiting_client | `Versão {v} enviada em {dd/mm/aaaa}` |
| closed | `Aceita por {name} em {data}` / `Recusada por {name} em {data}` |
| archived | `Arquivada` |

`truncated`: a note above the groups: "Mostrando as 200 propostas mais recentes."

Empty state (no items): "Nenhuma proposta ainda. Propostas são criadas a partir de uma oportunidade no Pipeline." with a link "Ir para o Pipeline" → `/pipeline`.

Loading: "Carregando..." (existing pattern). Error: "Não foi possível carregar as propostas." + "Tentar novamente".

## 6. Testing
- `deriveQueueSituation`: one case per rule and the tie-breaks (client changes + unsent edit → rules 3–5; APPROVED + unsent edit → not closed; stale → draft; not_required + never sent → draft; not_required + sent before + edit → ready_to_send).
- Endpoint (real Postgres): OWNER sees all org proposals with correct situations for a seeded mix; CREATOR sees only own; another org's proposals never appear; archived excluded unless `includeArchived=1`; `closedCount`; `truncated` at 201; totals and counterpart names; 401 without session.
- Page: group order/labels per role, empty groups hidden, detail lines, creator column only for agency, archived toggle, truncated note, empty state link, error retry.
- Real verification in the browser as OWNER and as the test creator.

## 7. Deploy
No migration, no env vars. Push.
