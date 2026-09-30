# Spec D — Creator approval before sending

Date: 2026-09-29. Status: approved design, pending written-spec review.
Depends on: spec 2 (sending: versions, publications, `/p/[token]`), spec B (CREATOR permissions), spec C (invite / access status).

## 1. Goal

When a creator has access to PublyFlow, the agency must get the creator's approval of the exact proposal version before sending it to the client. The creator approves or asks for changes from their read-only proposal view. OWNER/MANAGER can still send without approval, explicitly and on the record.

Out of scope: creator editing proposals, approval for anything other than proposals, e-mail notifications (in-app bell only), approval by anyone other than the owning creator.

## 2. Decisions (from brainstorming)

| # | Decision |
|---|----------|
| D1 | Approval is **required only when the opportunity's creator has access** — a CREATOR membership exists for the creator's user in this organization (access status `invited` or `active`). Status `none` or `team`: sending works exactly as today. |
| D2 | Flow: agency **requests** approval (creator is notified) → creator **approves** or **requests changes** (message required). Any edit after the request creates a new version and makes the request **stale**; the agency must request again. |
| D3 | OWNER and MANAGER may **send without approval** after a confirmation. The publication records it and the creator is notified. |
| D4 | The creator's read view keeps showing the **current draft** (the existing preview). An approval only counts when the request's version is the current latest version, so what the creator approves is exactly what they see. The sent version remains reachable via the public link and the send history. |
| D5 | Data model: a new `proposal_approvals` table, one row per request (history kept), plus two columns on `proposal_publications`. |

## 3. Data model — migration `0021_add_proposal_approvals`

### 3.1 `proposal_approval_decision` enum
`APPROVED`, `CHANGES_REQUESTED`.

### 3.2 `proposal_approvals`

| column | type | notes |
|---|---|---|
| id | uuid pk default random | |
| organization_id | uuid not null → organizations (cascade) | |
| proposal_id | uuid not null → proposals (cascade) | |
| request_number | integer not null | 1, 2, 3… per proposal; defines "latest" (never timestamps). unique (proposal_id, request_number) |
| version_id | uuid not null → proposal_versions (restrict) | the version under review |
| version_number | integer not null | denormalized, as in publications |
| requested_by | uuid not null → users (restrict) | |
| requested_at | timestamptz not null default now() | |
| decision | proposal_approval_decision null | null = pending |
| decided_by | uuid null → users (restrict) | |
| decided_at | timestamptz null | |
| message | text null | required when CHANGES_REQUESTED; optional on APPROVED |

Constraints:
- `check ((decision is null) = (decided_by is null) and (decision is null) = (decided_at is null))`.
- `check (decision <> 'CHANGES_REQUESTED' or (message is not null and length(btrim(message)) > 0))`.
- index on (proposal_id).
- RLS enabled with the same `org_isolation_*` policy pattern as the other tenant tables (the app role bypasses RLS; explicit `organization_id` predicates remain the tenant boundary in every query).

A decision is written once: the update is `... set decision = …, decided_by = …, decided_at = … where id = $1 and organization_id = $2 and decision is null`, and 0 rows updated → `ApprovalAlreadyDecidedError`.

### 3.3 `proposal_publications` — new columns
- `approval_id uuid null → proposal_approvals (restrict)`: the approval that authorized this send.
- `sent_without_approval boolean not null default false`.
- `check (not (sent_without_approval and approval_id is not null))`.

Existing rows: `approval_id` null, `sent_without_approval` false (sent before approvals existed; the UI shows nothing special for them). The migration is additive and safe to apply before the code.

## 4. Domain rules

### 4.1 Approval required
`approvalRequired(tx, organizationId, proposal)` is true when the proposal's opportunity creator has a `users` row with a `organization_members` row `role = 'CREATOR'` in `organizationId`. Evaluated at request time and again at publish time (access can be granted or revoked in between).

### 4.2 Approval state (derived, never stored)
Given the latest request (highest `request_number`) and the latest version:

| state | condition |
|---|---|
| `not_required` | 4.1 false |
| `none` | required, no request |
| `stale` | latest request `version_number` ≠ latest version number (any decision) |
| `pending` | request current, `decision` null |
| `approved` | request current, `decision = APPROVED` |
| `changes_requested` | request current, `decision = CHANGES_REQUESTED` |

### 4.3 Request approval — OWNER/MANAGER
In one transaction, lock the proposal row (`ProposalsRepository.lockByIdWithTx`, the lock publish already takes):
1. Proposal missing → 404; archived → `ProposalArchivedError` (409).
2. `approvalRequired` false → `ApprovalNotRequiredError` (409, "Este creator não tem acesso ao PublyFlow; envie direto.").
3. Latest request is for the latest version and is `pending` or `approved` → idempotent, return it (`created: false`).
4. Otherwise insert request `request_number = max + 1` for the latest version (this covers `none`, `stale`, and re-asking after `changes_requested`), append event `proposal.approval_requested`.

### 4.4 Creator decision — owning CREATOR only
Routes are callable only by a CREATOR session whose `creatorId` owns the proposal (via `proposalOutOfScope`: other creator's proposal → 404; OWNER/MANAGER → 403 "Somente o creator pode aprovar."). In one transaction, locking the proposal row:
1. No request, or latest request already decided → `NoPendingApprovalError` (409, "Não há pedido de aprovação pendente.").
2. Latest request is stale → `ApprovalStaleError` (409, "A proposta mudou depois do pedido de aprovação.").
3. Write the decision (guarded update, §3.2). Changes requested needs a message: 1–2000 chars after trim, else 400 `{ errors: { message: ["Descreva os ajustes."] } }`.
4. Append `proposal.creator_approved` or `proposal.creator_changes_requested`.

### 4.5 Publish gate — `ProposalSendingService.publish`
`publish(db, organizationId, proposalId, userId, { withoutApproval = false })`. Inside the existing transaction, after the lock and after the existing idempotency short-circuit (re-publishing an already-published latest version stays a no-op, not gated):
- `approvalRequired` false → publish as today (`approval_id` null, `sent_without_approval` false).
- state `approved` → publish with `approval_id` = that request.
- otherwise, `withoutApproval` true → publish with `sent_without_approval = true` and append `proposal.sent_without_approval`.
- otherwise → `ApprovalRequiredError` (409, "Aguardando aprovação do creator.").

`withoutApproval` is ignored (no flag stored) when approval is not required or already approved.

## 5. Events and notifications

New event types in `src/lib/events/proposal-events.ts`, payload = existing `basePayload` fields minus publication data where there is none, plus `approval_id`:

| event | audience | title | body |
|---|---|---|---|
| `proposal.approval_requested` | the owning creator only | Aprovação pedida | `Revise e aprove "{title}".` |
| `proposal.creator_approved` | OWNER/MANAGER only | Creator aprovou | `{creatorDisplayName} aprovou "{title}".` |
| `proposal.creator_changes_requested` | OWNER/MANAGER only | Creator pediu ajustes | `{creatorDisplayName} pediu ajustes em "{title}".` |
| `proposal.sent_without_approval` | the owning creator only | Enviada sem sua aprovação | `"{title}" foi enviada ao cliente sem sua aprovação.` |

`linkPath` = `/proposals/{id}` for all. `NotificationsRepository.fanOutWithTx` gains an audience mode: `{ kind: "staff" }` (OWNER/MANAGER), `{ kind: "creator", creatorUserId }` (that CREATOR member only), keeping today's behaviour (`staff + owning creator`) for the client-response events.

## 6. API

| method & path | who | body | success |
|---|---|---|---|
| `POST /api/proposals/[id]/approval` | OWNER/MANAGER (`canManageOrganization`) | — | 201 new request / 200 idempotent; `{ approval }` |
| `POST /api/proposals/[id]/approval/approve` | owning CREATOR | `{ message?: string }` (≤2000) | 200 `{ approval }` |
| `POST /api/proposals/[id]/approval/request-changes` | owning CREATOR | `{ message: string }` | 200 `{ approval }` |
| existing publish route | OWNER/MANAGER | adds optional `{ withoutApproval: boolean }` | unchanged |

- All `[id]` routes keep the `isUuid` guard (malformed → 404).
- The two creator routes are added to the `write-guard.test.ts` allowlist with a comment; they must still reject non-CREATOR sessions with 403.
- Errors map to 409 with `{ error }` as in §4; Postgres 40P01 → 409 `DEADLOCK_MESSAGE` (`src/lib/db-errors.ts`).
- `GET .../send-state` gains `approval: { state, required, current: { id, versionNumber, requestedAt, requestedByName, decision, decidedAt, message } | null }`. CREATOR sessions already read send-state for their own proposals (spec B); this is the only read endpoint the approval UI needs.
- Publication history items gain `approvedByName: string | null` and `sentWithoutApproval: boolean`.

## 7. UI

### 7.1 Agency — send panel (builder)
Approval block above the send button, driven by `approval.state`:

| state | text | actions |
|---|---|---|
| `not_required` | — (panel as today) | Enviar |
| `none` | "Este creator precisa aprovar a proposta antes do envio." | **Pedir aprovação** · Enviar sem aprovação |
| `pending` | "Aguardando aprovação de {creator} (versão {n})." | Enviar sem aprovação |
| `approved` | "Aprovada por {creator} em {data}." | **Enviar** |
| `changes_requested` | "{creator} pediu ajustes:" + message | **Pedir aprovação** · Enviar sem aprovação |
| `stale` | "A proposta mudou depois do pedido de aprovação." | **Pedir aprovação** · Enviar sem aprovação |

- "Enviar sem aprovação" opens an AlertDialog: title "Enviar sem aprovação", body "{creator} ainda não aprovou esta versão. A proposta será enviada ao cliente e {creator} será avisado(a).", buttons "Cancelar" / "Enviar sem aprovação" (destructive). Buttons disabled while pending (`isPending`).
- Toasts: "Pedido de aprovação enviado.", existing send toasts unchanged.
- Send history rows add "Aprovada por {nome}" or "Enviada sem aprovação" under the publication.

### 7.2 Creator — `ProposalReadView`
Block "Aprovação" above the preview, only when `approval.required`:

| state | content |
|---|---|
| `pending` | "{requestedByName} pediu sua aprovação desta versão." + **Aprovar** · **Pedir ajustes** |
| `approved` | "Você aprovou esta versão em {data}." |
| `changes_requested` | "Você pediu ajustes em {data}:" + message |
| `stale` | "A proposta mudou depois do pedido. Aguarde um novo pedido da agência." |
| `none` | nothing |

- **Aprovar** opens an AlertDialog "Aprovar proposta" / "A agência poderá enviar esta versão ao cliente." / "Cancelar" · "Aprovar". Toast "Proposta aprovada.".
- **Pedir ajustes** opens a Dialog with a required textarea (label "O que precisa mudar?") and "Cancelar" · "Enviar pedido". Toast "Pedido de ajustes enviado.".
- 409 responses toast the server message and refetch send-state.

## 8. Concurrency
- Request, decision and publish all lock the proposal row first and read the latest version **after** the lock; staleness is derived there.
- Edits create versions without that lock. If an edit commits while a publish is running, the publish sends the version it read (the approved one; version rows are immutable) and the new version simply shows as unsent + stale afterwards. A publish can never send a version that differs from the approved one: it requires the approved request's `version_number` to equal the latest version read under the lock.
- The decision update is guarded by `decision is null` (§3.2).

## 9. Testing
- Repository/service (real Postgres, Vitest): `approvalRequired` (none/invited/active/team); state derivation table (§4.2) incl. stale after an edit; request idempotency and re-request after changes/stale; decision rules (not owner → 404/403 at route, stale, already decided, message validation); publish gate (required+approved stores `approval_id`; required+not approved → 409; `withoutApproval` stores flag + event; not required unchanged; idempotent re-publish not gated); constraints reject inconsistent rows.
- Events: the four events produce the right audience (creator-only vs staff-only).
- Routes: auth matrix (OWNER/MANAGER/owning CREATOR/other CREATOR), malformed id, 409 mappings, write-guard allowlist.
- UI: send panel per state; creator block per state; dialogs; disabled while pending.
- Real verification (browser, local dev DB, test creator devandanalytics@gmail.com with access): request → creator sees bell + block → approve → agency sends (history shows "Aprovada por"); edit after approval → stale → request again → creator requests changes → agency sends without approval → creator bell shows "Enviada sem sua aprovação".

## 10. Deploy
1. Controller applies migration 0021 to production (additive; old code ignores the new table/columns).
2. User pushes.
No new env vars.
