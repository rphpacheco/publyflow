# Inbox: edit inquiry data before converting + readable error messages

Date: 2026-09-30. Status: approved design (user, 2026-09-30), pending written-spec review.
Origin: production bug — "Converter em Opportunity" on an inquiry without company/brand did nothing and showed an empty toast.

## 1. Root cause (reproduced locally)

1. `OpportunityService.createFromLeadWithTx` requires company or brand (`InvalidOpportunityPartyError`). The inquiry had no `companyGuess`/`brandGuess`, and one-click convert sends neither id.
2. `POST /api/commercial-inquiries/[id]/convert` doesn't map that error → unhandled → 500 with a non-JSON body.
3. `apiFetch` falls back to `response.statusText`, which is empty over HTTP/2 → `ApiError.message === ""` → empty toast. Affects every unexpected 500 in the app.
4. The inbox edit form only lets the user *select* existing companies/brands; the production org has none (no Companies page yet), so such inquiries can never be converted.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | The rule "an Opportunity always has a company or a brand" stays. |
| D2 | While an inquiry is `NEW`, OWNER/MANAGER can edit its contact / company / brand data (the `*_guess` columns) from the inbox side panel. Conversion then uses them exactly as it uses AI guesses today (find-or-create by exact name; ambiguity → existing flow). |
| D3 | Converting without company and brand is refused up front with a clear message and the panel opens the edit form — nothing is created. |
| D4 | Every error toast shows its cause: known (business) errors return a Portuguese message; unexpected 500s show a generic message **plus the request reference** (`x-vercel-id` header) so the exact cause can be found in the Vercel logs. Raw exception text is never sent to the browser (it can contain SQL/table names). |

## 3. Server

### 3.1 `PATCH /api/commercial-inquiries/[id]`
- Auth: session (401); `denyCreatorWrite` (CREATOR → 403); `isUuid` (malformed → 404).
- Body (zod, all optional, at least one key): `contactName`, `companyName`, `brandName` — each `string` trimmed, max 200, or `null` to clear. Empty string after trim = `null`. 400 `{ errors: fieldErrors }` on invalid.
- Service `CommercialInquiryService.updateGuesses(db, organizationId, inquiryId, input)` in one tenant transaction: lock the inquiry row (`FOR UPDATE`, org predicate); not found → `InquiryNotFoundError` (404); status ≠ `NEW` → `InquiryAlreadyResolvedError` (409); update only the provided columns (`contact_name_guess`, `company_guess`, `brand_guess`); return the updated inquiry DTO (same shape as the inbox list item).

### 3.2 Convert guard
In `CommercialInquiryService.resolve`, before any insert: if the resolved `companyId` and `brandId` are both null (no explicit ids and no usable guesses), throw a new `InquiryPartyRequiredError` (domain/commercial-flow/errors.ts). The route maps it to **422** `{ error: "Informe a empresa ou a marca antes de converter.", code: "PARTY_REQUIRED" }`.

### 3.3 Portuguese messages on the inquiry routes
`convert`, `discard`, `mark-false-positive` and the new `PATCH` map domain errors to user-facing Portuguese (don't change the error classes' own messages, other code/tests may rely on them):
- `InquiryNotFoundError` → 404 "Mensagem não encontrada."
- `InquiryAlreadyResolvedError` → 409 "Esta mensagem já foi resolvida."
- `AmbiguousPartyGuessError` → 422 `code: "AMBIGUOUS_PARTY"` "Mais de uma empresa ou marca com esse nome — selecione a correta."
- `InquiryPartyRequiredError` → 422 `code: "PARTY_REQUIRED"` (above).
- `InvalidOpportunityPartyError` (defensive, should be unreachable after 3.2) → 422 `code: "PARTY_REQUIRED"` same message.
- zod parse failures on these routes → 400 `{ errors }` instead of an unhandled throw (use `safeParse`).

## 4. Client

### 4.1 `apiFetch` (src/lib/api-client.ts) — every screen
When the error body has no string `error`:
- status ≥ 500: `"Erro inesperado no servidor ({status})."` + (if the response has an `x-vercel-id` header) `" Referência: {x-vercel-id}"`.
- otherwise: `"Não foi possível concluir a ação ({status})."`.
`ApiError` gains `requestId: string | null` (from `x-vercel-id`). Server-provided `{ error }` messages are unchanged.

### 4.2 Inbox side panel (src/components/inbox/inquiry-side-panel.tsx)
- For `NEW` inquiries (not readOnly), a "Dados" block always shows **Contato**, **Empresa**, **Marca** with the current values or "—", and a button **"Editar dados"**.
- "Editar dados" opens an inline form with three text inputs (labels "Contato", "Empresa", "Marca"), buttons "Cancelar" / "Salvar". Save → PATCH; success toast "Dados atualizados."; the panel shows the new values; errors toast the server message.
- "Converter em Opportunity": sends `contact: { fullName: contactNameGuess ?? externalContactLabel ?? "Desconhecido" }` (use the sender label before "Desconhecido"). On 422 `PARTY_REQUIRED` → toast the server message and open "Editar dados". On 422 `AMBIGUOUS_PARTY` → existing behavior (open the select-existing form). Other errors → toast `error.message` (never empty now).
- Existing AI-guess lines (Orçamento/Intenção) stay.

## 5. Testing
- Service: `updateGuesses` (updates only provided keys, null clears, NEW only, org-scoped, not found); `resolve` with no company/brand → `InquiryPartyRequiredError` and **nothing inserted** (no contact/lead/opportunity rows); after `updateGuesses({ companyName: "Marca X" })`, resolve creates the company and converts.
- Routes: PATCH auth matrix (401/403 CREATOR/404 malformed/404 other org/409 resolved/400 invalid) and 200 body; convert 422 PARTY_REQUIRED message+code; PT messages for 404/409/422; invalid body → 400 (not 500); write-guard still green.
- `apiFetch`: 500 with empty body and `x-vercel-id` → message includes "Erro inesperado no servidor (500). Referência: …" and `requestId`; 500 without header → no "Referência"; 404 non-JSON → "Não foi possível concluir a ação (404)."; JSON `{ error }` unchanged.
- Panel: data block + edit flow; convert → PARTY_REQUIRED opens edit; contact fallback uses the sender label.
- Real verification in production after deploy: the user converts the "Rodolfo Barbosa" message after filling the company (or brand).

## 6. Deploy
No migration, no env vars. Push.

## 7. Follow-up (out of scope)
Other API routes may also leak English domain messages or throw on invalid bodies; audit them in a separate pass.
