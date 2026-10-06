# Tech Debt Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six small fixes: lazy AI clients (503 when not configured), two indexes + creators unique index (migration 0024), org check for explicit ids on inbox conversion, server-side reopen confirmation on publish, and the "Nova Proposta" theme hint.

**Architecture:** Each task is independent and touches its own area; only Task 2 adds a migration. Existing layering (route → service → repository), error mappers and UI patterns are reused.

**Tech Stack:** Next.js 16, React 19, TanStack Query, Drizzle + Postgres, zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-tech-debt-batch-design.md`

## Global Constraints

- Every query org-scoped; no `Promise.all` inside one `runInTenantContext` transaction.
- Messages verbatim: 503 `AI_NOT_CONFIGURED` "A classificação por IA não está configurada neste ambiente." · 422 `COMPANY_NOT_FOUND` "Empresa selecionada não encontrada." · 422 `BRAND_NOT_FOUND` "Marca selecionada não encontrada." · 409 `REOPEN_REQUIRED` "Esta proposta já foi respondida pelo cliente. Confirme para abrir uma nova rodada." · hint "Escolha um tema para criar a proposta."
- UI: no emoji/symbol glyphs (lucide icons only); nothing overflowing containers.
- Tests: `/opt/homebrew/bin/pnpm vitest run <files> --testTimeout=60000 --hookTimeout=60000`, focused files only, never two vitest processes, never the full suite from the repo root while a worktree exists (`--dir src`). Subagents never run `drizzle-kit migrate`, docker, or touch dev/prod DBs (generating migration files is allowed).
- Commit per task; message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Lazy AI clients + 503 when OpenAI is not configured

**Files:** Modify `src/lib/ai/index.ts`, `src/lib/ai/composite-provider.ts` (if needed), `src/services/inbox.service.ts`, `src/app/api/inbox/messages/route.ts`; Create `src/lib/ai/errors.ts`; Tests: `src/lib/ai/index.test.ts` (new), `src/lib/ai/composite-provider.test.ts` (extend), `src/app/api/inbox/messages/route.test.ts` (extend).

**Interfaces (Produces):** `export class AiNotConfiguredError extends Error` (`src/lib/ai/errors.ts`); `ai: AIService` keeps its shape (`classifyMessage`).

- [ ] **Step 1: Failing tests**
  - `index.test.ts`: with `OPENAI_API_KEY` and `JEV_API_KEY` deleted from `process.env` (restore after), `await import("@/lib/ai")` resolves (use `vi.resetModules()`); calling `ai.classifyMessage(...)` rejects with `AiNotConfiguredError`.
  - composite: when the Jev dependency is absent/unconfigured (factory returns `null` for Jev), `classifyMessage` uses OpenAI's `classifyIntent` and never calls Jev.
  - route: with `ai` mocked to reject with `AiNotConfiguredError` (via `importRouteWithSession` + `extraMocks` `vi.doMock("@/lib/ai", ...)`), `POST /api/inbox/messages` returns 503 `{ error: "A classificação por IA não está configurada neste ambiente.", code: "AI_NOT_CONFIGURED" }`; the existing 502 test still passes.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**
`src/lib/ai/errors.ts`:
```ts
export class AiNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`AI provider not configured: ${missing} is missing`);
    this.name = "AiNotConfiguredError";
  }
}
```
`src/lib/ai/index.ts` (lazy; same exported name and shape):
```ts
import type { AIService } from "./ai-service";
import { createJevService } from "./jev-provider";
import { createOpenAIService } from "./openai-provider";
import { createCompositeAIService } from "./composite-provider";
import { AiNotConfiguredError } from "./errors";

let instance: AIService | null = null;

// Built on first use so importing a route never crashes when a key is absent (local dev).
function getService(): AIService {
  if (instance) return instance;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new AiNotConfiguredError("OPENAI_API_KEY");
  const jevKey = process.env.JEV_API_KEY;
  instance = createCompositeAIService({
    jev: jevKey ? createJevService(jevKey) : null,
    openai: createOpenAIService(openaiKey),
  });
  return instance;
}

export const ai: AIService = {
  classifyMessage: (input) => getService().classifyMessage(input),
};
export { AiNotConfiguredError };
```
`composite-provider.ts`: `jev: Pick<JevService, "classifyIntent"> | null`; in `classifyIntent`, `if (!deps.jev) return deps.openai.classifyIntent(input);` before the try. (Keep the existing `Promise.all` there — it runs two HTTP calls, not DB queries.)
`inbox.service.ts` catch: `if (error instanceof AiNotConfiguredError) throw error;` before wrapping in `MessageClassificationError`.
Route: map `AiNotConfiguredError` → 503 body above (before the existing 502 branch).
- [ ] **Step 4: Run — PASS** (`src/lib/ai src/app/api/inbox src/services/inbox.service.test.ts`).
- [ ] **Step 5: Commit** `fix(ai): build AI clients lazily; 503 when OpenAI is not configured`.

---

### Task 2: Migration 0024 — proposal indexes + creators unique

**Files:** Modify `src/db/schema/proposals.ts`, `src/db/schema/creators.ts`; generated `src/db/migrations/0024_*.sql` + meta; Tests: extend `src/db/schema/creators.test.ts` (or create) and a service test for the creator 409 path.

- [ ] **Step 1:** Schema:
  - `proposals`: table callback `(table) => [index("proposals_org_created_at_idx").on(table.organizationId, table.createdAt)]` (keep existing columns; add the callback if absent).
  - `proposalItems`: `index("proposal_items_proposal_idx").on(table.proposalId)`.
  - `creators`: `uniqueIndex("creators_org_user_unique").on(table.organizationId, table.userId)`.
- [ ] **Step 2:** `/opt/homebrew/bin/pnpm drizzle-kit generate --name proposal_indexes_creators_unique`; confirm the SQL only creates these 3 indexes (no other changes); journal idx 24.
- [ ] **Step 3: Tests** — inserting a second `creators` row with the same (organization_id, user_id) rejects with code 23505; the existing creator registration path that inserts a creator for an already-linked user (find it in `src/services/creator.service.ts`, `isUniqueViolation` → `CreatorEmailTakenError`) returns that error — add a test that forces the violation (e.g. register twice for the same user in the same org through the repository/service path) if not already covered.
- [ ] **Step 4:** STOP and report NEEDS_CONTEXT "0024 ready — apply to test DB"; after the controller applies it, run `src/db/schema/creators* src/services/creator.service.test.ts src/repositories/creators.repository.test.ts` and commit `feat(db): proposal indexes and one creator per user per org (0024)`.

---

### Task 3: Inbox conversion — explicit company/brand ids must belong to the org

**Files:** Modify `src/services/commercial-inquiry.service.ts`, `src/domain/commercial-flow/errors.ts`, `src/app/api/commercial-inquiries/[id]/inquiry-errors.ts`; Tests: extend `src/services/commercial-inquiry.service.test.ts` and `src/app/api/commercial-inquiries/[id]/convert/route.test.ts`.

**Interfaces (Produces):** `ExplicitPartyNotFoundError(kind: "company" | "brand", id: string)` in `src/domain/commercial-flow/errors.ts`.

- [ ] **Step 1: Failing tests** — convert with `companyId` of another org → `ExplicitPartyNotFoundError` and no contact/lead/opportunity rows created; same for `brandId`; unknown uuid → same; own-org ids still convert. Route: 422 bodies `{ error: "Empresa selecionada não encontrada.", code: "COMPANY_NOT_FOUND" }` / `{ error: "Marca selecionada não encontrada.", code: "BRAND_NOT_FOUND" }`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — in `resolvePartyIdFromGuess`, when `explicitId` is a non-null string, look it up with the repo's `findByIdWithTx(tx, organizationId, explicitId)` (add `findByIdWithTx` to the `repo` parameter type; `CompaniesRepository` and `BrandsRepository` already have it) and throw `ExplicitPartyNotFoundError` when missing; `null` / `undefined` keep today's behavior. Map the error in `inquiryErrorResponse` (422 per kind). The check happens before any insert (the function runs before contact/lead creation — keep it that way).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `fix(inbox): explicit company/brand ids on conversion must belong to the org`.

---

### Task 4: Publish requires `reopen: true` for an accepted/rejected proposal

**Files:** Modify `src/services/proposal-sending.service.ts`, `src/domain/proposals/errors.ts`, `src/app/api/proposals/[id]/publications/route.ts`, `src/hooks/use-proposal-sending.ts`, `src/components/proposals/proposal-send-panel.tsx`; Tests: extend the service test, route test, hook test and `proposal-send-panel.test.tsx`.

**Interfaces (Produces):** `ReopenRequiredError` (proposals domain); `publish(db, org, proposalId, userId, options: { withoutApproval?: boolean; reopen?: boolean })`; publish mutation accepts `{ withoutApproval?: boolean; reopen?: boolean }`.

- [ ] **Step 1: Failing tests**
  - Service: proposal APPROVED (client accepted) + a new version → `publish` without `reopen` throws `ReopenRequiredError` and creates no publication; with `{ reopen: true }` publishes and status becomes `SENT`; same for REJECTED; re-sending the already-published version (idempotent path) needs no `reopen`; DRAFT / SENT / CHANGES_REQUESTED publish without `reopen`.
  - Route: 409 `{ error: "Esta proposta já foi respondida pelo cliente. Confirme para abrir uma nova rodada.", code: "REOPEN_REQUIRED" }`; `reopen: true` in the body is passed through.
  - Panel: confirming the "Reenviar abre uma nova rodada…" dialog calls the mutation with `reopen: true` (and `withoutApproval` when that path was used); a mutation rejection `ApiError(409, …, { code: "REOPEN_REQUIRED" })` opens the same confirmation dialog instead of showing an error.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — in `publish`, after the idempotent early return and before creating the publication: `if ((proposal.status === "APPROVED" || proposal.status === "REJECTED") && !options.reopen) throw new ReopenRequiredError(proposalId);`. Route: `const reopen = body?.reopen === true;` pass through; map the error to the 409 body. Hook: send `{ withoutApproval?, reopen? }` in the JSON body. Panel: the confirm action passes `reopen: true`; on a 409 with `code === "REOPEN_REQUIRED"`, set the confirm state for the current status (APPROVED/REJECTED from the error's refreshed send state, or refetch send state first, as `checkAndSend` does) so the dialog opens.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `fix(proposals): require explicit reopen to resend an accepted/rejected proposal`.

---

### Task 5: "Nova Proposta" theme hint

**Files:** Modify `src/components/pipeline/opportunity-side-panel.tsx`; Test: `src/components/pipeline/opportunity-side-panel.test.tsx`.

- [ ] **Step 1: Failing test** — open the "Nova Proposta" dialog: without a theme, the text "Escolha um tema para criar a proposta." is visible and the "Criar" button is disabled with `aria-describedby` pointing to the hint's id; after choosing a theme, the hint is gone and "Criar" is enabled.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — under the theme `Select`, render `{!theme ? <p id="new-proposal-theme-hint" className="text-xs text-muted-foreground">Escolha um tema para criar a proposta.</p> : null}` and set `aria-describedby={!theme ? "new-proposal-theme-hint" : undefined}` on "Criar". No glyphs.
- [ ] **Step 4: Run — PASS** (`src/components/pipeline/opportunity-side-panel.test.tsx`).
- [ ] **Step 5: Commit** `fix(pipeline): explain why "Criar" is disabled in the new proposal dialog`.

---

### Task 6: Verification (controller)
- [ ] tsc, lint (no new findings), 0024 on test (before Task 2 tests) and dev DBs, full suite `--dir src`, build.
- [ ] Final whole-branch review + fix wave.
- [ ] Browser: inbox locally without `OPENAI_API_KEY` shows the 503 message on "Nova Mensagem"; reopen confirmation on an accepted proposal; Nova Proposta hint.
- [ ] Deploy: read-only duplicate re-check on prod creators → apply 0024 → push → confirm deploy. Update TAREFA.
