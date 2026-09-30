# Inquiry Edit + Readable Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the production bug where converting an inbox message without company/brand did nothing and showed an empty toast, by (a) letting OWNER/MANAGER edit the message's contact/company/brand before converting, (b) refusing conversion without company/brand with a clear message, and (c) making every error toast show its cause.

**Architecture:** `apiFetch` builds a non-empty message for non-JSON errors (5xx includes the `x-vercel-id` reference). `CommercialInquiryService` gains `updateGuesses` and a guard in `resolve` (`InquiryPartyRequiredError`). Inquiry routes share one Portuguese error mapper and use `safeParse`. The inbox side panel gets a "Dados" block with inline editing and routes `PARTY_REQUIRED` into it.

**Tech Stack:** Next.js 16 App Router, React 19 + TanStack Query, Drizzle + Postgres, zod 4, Vitest (+ Testing Library, jsdom).

Spec: `docs/superpowers/specs/2026-09-30-inquiry-edit-and-error-messages-design.md`.

## Global Constraints

- An Opportunity always has a company or a brand (rule unchanged).
- Only `NEW` inquiries are editable/convertible; OWNER/MANAGER only (CREATOR → 403 via `denyCreatorWrite`).
- Explicit `organization_id` predicate on every query (the app role bypasses RLS).
- Exact user-facing copy: "Informe a empresa ou a marca antes de converter." (code `PARTY_REQUIRED`, 422); "Mensagem não encontrada." (404); "Esta mensagem já foi resolvida." (409); "Mais de uma empresa ou marca com esse nome — selecione a correta." (code `AMBIGUOUS_PARTY`, 422); `apiFetch` fallbacks "Erro inesperado no servidor ({status})." + " Referência: {x-vercel-id}" when the header exists, and "Não foi possível concluir a ação ({status})."; panel: "Dados", "Contato", "Empresa", "Marca", "—", "Editar dados", "Cancelar", "Salvar", toast "Dados atualizados.".
- Raw exception text is never sent to the browser.
- **Hard DB rule for implementers:** never start/stop/restart Docker containers, never run drizzle-kit, never create/drop databases, never run psql. If the test DB fails in any way, STOP and report BLOCKED. Don't start dev servers.
- Commands: `/opt/homebrew/bin/pnpm vitest run <paths> --testTimeout=60000 --hookTimeout=60000`; `/opt/homebrew/bin/pnpm tsc --noEmit`. Plain commands; never bare `git stash`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/api-client.ts` (+test) | non-empty error messages, `requestId` |
| `src/domain/commercial-flow/errors.ts` | `InquiryPartyRequiredError` |
| `src/repositories/commercial-inquiries.repository.ts` | `lockByIdWithTx`, `updateGuessesWithTx` |
| `src/services/commercial-inquiry.service.ts` (+test) | `updateGuesses`, resolve guard |
| `src/app/api/commercial-inquiries/[id]/inquiry-errors.ts` | shared PT error mapper |
| `src/app/api/commercial-inquiries/[id]/route.ts` (+test) | `PATCH` |
| `.../[id]/convert|discard|mark-false-positive/route.ts` (+tests) | mapper + `safeParse` |
| `src/hooks/use-inquiry-mutations.ts` (+test) | `useUpdateInquiryGuesses` |
| `src/components/inbox/inquiry-side-panel.tsx` (+test) | Dados block, edit, convert handling |

---

### Task 1: `apiFetch` readable fallbacks

**Files:** Modify `src/lib/api-client.ts`, `src/lib/api-client.test.ts`.

**Produces:** `ApiError { status: number; message: string; body: unknown; requestId: string | null }` (constructor `new ApiError(status, message, body = null, requestId = null)`).

- [ ] **Step 1: Failing tests** (append to the existing describe; the fetch mocks there are plain objects — add `headers: new Headers({...})` where needed and make `json` reject for non-JSON bodies):
```ts
  it("5xx without a JSON error: generic message plus the Vercel request reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "",
        headers: new Headers({ "x-vercel-id": "gru1::iad1::abc123" }),
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      }),
    );
    const error = await apiFetch("/api/example").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("Erro inesperado no servidor (500). Referência: gru1::iad1::abc123");
    expect((error as ApiError).requestId).toBe("gru1::iad1::abc123");
  });

  it("5xx without a JSON error and without the header: no reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "",
        headers: new Headers(),
        json: async () => ({}),
      }),
    );
    const error = (await apiFetch("/api/example").catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("Erro inesperado no servidor (502).");
    expect(error.requestId).toBeNull();
  });

  it("4xx without a JSON error: 'Não foi possível concluir a ação'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "",
        headers: new Headers(),
        json: async () => {
          throw new SyntaxError("not json");
        },
      }),
    );
    const error = (await apiFetch("/api/example").catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("Não foi possível concluir a ação (404).");
  });
```
Existing tests whose mocks lack `headers` must keep passing — read headers defensively (`response.headers?.get?.("x-vercel-id") ?? null`). The existing "throws ApiError with the response status and error message" test (JSON `{ error }`) must still yield the server message unchanged.
Run `/opt/homebrew/bin/pnpm vitest run src/lib/api-client.test.ts --testTimeout=60000` → new tests FAIL.

- [ ] **Step 2: Implement**
```ts
export class ApiError extends Error {
  status: number;
  readonly body: unknown;
  readonly requestId: string | null;

  constructor(status: number, message: string, body: unknown = null, requestId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

function fallbackMessage(status: number, requestId: string | null): string {
  if (status >= 500) {
    return `Erro inesperado no servidor (${status}).${requestId ? ` Referência: ${requestId}` : ""}`;
  }
  return `Não foi possível concluir a ação (${status}).`;
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const requestId = response.headers?.get?.("x-vercel-id") ?? null;
    let message: string | null = null;
    let body: unknown = null;
    try {
      body = await response.json();
      if (body && typeof (body as { error?: unknown }).error === "string" && (body as { error: string }).error.trim()) {
        message = (body as { error: string }).error;
      }
    } catch {
      // Response body wasn't JSON -- fall back to a readable message below.
    }
    throw new ApiError(response.status, message ?? fallbackMessage(response.status, requestId), body, requestId);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
```
- [ ] **Step 3:** Run the file → PASS. Run `/opt/homebrew/bin/pnpm vitest run src/hooks src/components --testTimeout=60000 --hookTimeout=60000` (callers may assert on old messages) → PASS; adapt only assertions that depended on the old empty/statusText fallback, keeping their intent. `tsc --noEmit` clean.
- [ ] **Step 4: Commit** `fix(api-client): readable error messages with request reference`.

---

### Task 2: Service — `updateGuesses` and the convert guard

**Files:** Modify `src/domain/commercial-flow/errors.ts`, `src/repositories/commercial-inquiries.repository.ts`, `src/services/commercial-inquiry.service.ts`, `src/services/commercial-inquiry.service.test.ts`.

**Produces:**
```ts
export class InquiryPartyRequiredError extends Error // name "InquiryPartyRequiredError"
CommercialInquiriesRepository.lockByIdWithTx(tx, organizationId, inquiryId): Promise<CommercialInquiry | null>
CommercialInquiriesRepository.updateGuessesWithTx(tx, organizationId, inquiryId, fields: Partial<{ contactNameGuess: string | null; companyGuess: string | null; brandGuess: string | null }>): Promise<CommercialInquiry | null>
export interface UpdateInquiryGuessesInput { contactName?: string | null; companyName?: string | null; brandName?: string | null }
CommercialInquiryService.updateGuesses(db, organizationId, inquiryId, input: UpdateInquiryGuessesInput): Promise<CommercialInquiry>
```

- [ ] **Step 1: Failing tests** (append to `src/services/commercial-inquiry.service.test.ts`, reusing its `setupOrgAndCreator`, `fakeAI`, `InboxService.ingestManualMessage`):
```ts
describe("inquiry without company/brand (production bug 2026-09-30)", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  const noGuesses = fakeAI({
    category: "COMMERCIAL_LEAD",
    commercialScore: 80,
    intent: "orçamento",
    extracted: { companyName: null, brandName: null, contactName: null, email: null, phone: null, budget: null, deliverables: null },
  });

  async function setupInquiry() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setupOrgAndCreator(db);
    const { inquiry } = await InboxService.ingestManualMessage(db, noGuesses, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Rodolfo Barbosa",
      body: "Queria fazer um orçamento para divulgação da minha marca contigo.",
      receivedAt: new Date(),
    });
    return { db, organization, creator, inquiryId: inquiry!.id };
  }

  it("resolve refuses with InquiryPartyRequiredError and inserts nothing", async () => {
    const { db, organization, inquiryId } = await setupInquiry();
    await expect(
      CommercialInquiryService.resolve(db, organization.id, inquiryId, { contact: { fullName: "Rodolfo Barbosa" } }),
    ).rejects.toBeInstanceOf(InquiryPartyRequiredError);
    expect(await db.select().from(leads).where(eq(leads.organizationId, organization.id))).toHaveLength(0);
    expect(await db.select().from(contacts).where(eq(contacts.organizationId, organization.id))).toHaveLength(0);
    expect((await CommercialInquiryService.findById(db, organization.id, inquiryId))?.status).toBe("NEW");
  });

  it("updateGuesses sets only the provided keys, trims, and null clears", async () => {
    const { db, organization, inquiryId } = await setupInquiry();
    const updated = await CommercialInquiryService.updateGuesses(db, organization.id, inquiryId, {
      contactName: "  Rodolfo Barbosa ",
      companyName: "Barbosa Moda",
    });
    expect(updated).toMatchObject({ contactNameGuess: "Rodolfo Barbosa", companyGuess: "Barbosa Moda", brandGuess: null });
    const cleared = await CommercialInquiryService.updateGuesses(db, organization.id, inquiryId, { companyName: null, brandName: "BM" });
    expect(cleared).toMatchObject({ contactNameGuess: "Rodolfo Barbosa", companyGuess: null, brandGuess: "BM" });
  });

  it("after updateGuesses, resolve creates the company and converts", async () => {
    const { db, organization, inquiryId } = await setupInquiry();
    await CommercialInquiryService.updateGuesses(db, organization.id, inquiryId, { companyName: "Barbosa Moda" });
    const result = await CommercialInquiryService.resolve(db, organization.id, inquiryId, { contact: { fullName: "Rodolfo Barbosa" } });
    expect(result.opportunity.companyId).not.toBeNull();
    const [company] = await db.select().from(companies).where(eq(companies.organizationId, organization.id));
    expect(company.name).toBe("Barbosa Moda");
    expect((await CommercialInquiryService.findById(db, organization.id, inquiryId))?.status).toBe("CONVERTED");
  });

  it("updateGuesses rejects non-NEW inquiries and other organizations", async () => {
    const { db, organization, inquiryId } = await setupInquiry();
    await CommercialInquiryService.discard(db, organization.id, inquiryId);
    await expect(
      CommercialInquiryService.updateGuesses(db, organization.id, inquiryId, { companyName: "X" }),
    ).rejects.toBeInstanceOf(InquiryAlreadyResolvedError);
    const other = await setupOrgAndCreator(db);
    await expect(
      CommercialInquiryService.updateGuesses(db, other.organization.id, inquiryId, { companyName: "X" }),
    ).rejects.toBeInstanceOf(InquiryNotFoundError);
  });
});
```
(Add `InquiryPartyRequiredError` to the errors import.) Run → FAIL.

- [ ] **Step 2: Error class** — append to `src/domain/commercial-flow/errors.ts`:
```ts
// Thrown by CommercialInquiryService.resolve when neither an explicit
// company/brand id nor a usable company/brand guess exists: an Opportunity
// always needs one of them, so conversion is refused before any insert.
export class InquiryPartyRequiredError extends Error {
  constructor(inquiryId: string) {
    super(`Commercial inquiry ${inquiryId} has no company or brand to convert`);
    this.name = "InquiryPartyRequiredError";
  }
}
```
- [ ] **Step 3: Repository** — add to `CommercialInquiriesRepository`:
```ts
  async lockByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<CommercialInquiry | null> {
    const [row] = await tx
      .select()
      .from(commercialInquiries)
      .where(and(eq(commercialInquiries.id, inquiryId), eq(commercialInquiries.organizationId, organizationId)))
      .for("update");
    return row ?? null;
  },

  async updateGuessesWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
    fields: Partial<Pick<CommercialInquiry, "contactNameGuess" | "companyGuess" | "brandGuess">>,
  ): Promise<CommercialInquiry | null> {
    const [row] = await tx
      .update(commercialInquiries)
      .set(fields)
      .where(and(eq(commercialInquiries.id, inquiryId), eq(commercialInquiries.organizationId, organizationId)))
      .returning();
    return row ?? null;
  },
```
- [ ] **Step 4: Service.** In `resolve`, right after `brandId` is computed (before `explicitContactId`):
```ts
      // Spec 2026-09-30 §3.2: an Opportunity needs a company or a brand;
      // refuse before inserting anything (contact, lead, opportunity).
      if (!companyId && !brandId) throw new InquiryPartyRequiredError(inquiryId);
```
Add to `CommercialInquiryService`:
```ts
  async updateGuesses(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
    input: UpdateInquiryGuessesInput,
  ): Promise<CommercialInquiry> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const inquiry = await CommercialInquiriesRepository.lockByIdWithTx(tx, organizationId, inquiryId);
      if (!inquiry) throw new InquiryNotFoundError(inquiryId);
      if (inquiry.status !== "NEW") throw new InquiryAlreadyResolvedError(inquiryId, inquiry.status);

      const normalize = (value: string | null) => {
        const trimmed = value?.trim() ?? "";
        return trimmed === "" ? null : trimmed;
      };
      const fields: Partial<Pick<CommercialInquiry, "contactNameGuess" | "companyGuess" | "brandGuess">> = {};
      if (input.contactName !== undefined) fields.contactNameGuess = normalize(input.contactName);
      if (input.companyName !== undefined) fields.companyGuess = normalize(input.companyName);
      if (input.brandName !== undefined) fields.brandGuess = normalize(input.brandName);
      if (Object.keys(fields).length === 0) return inquiry;

      const updated = await CommercialInquiriesRepository.updateGuessesWithTx(tx, organizationId, inquiryId, fields);
      if (!updated) throw new InquiryNotFoundError(inquiryId);
      return updated;
    });
  },
```
(Export `UpdateInquiryGuessesInput`; import `CommercialInquiry` type from the repository if not already.) Note: `resolve` reads the inquiry outside its transaction today; leave that as is.
- [ ] **Step 5:** Run the service test file → PASS (existing tests that resolve with a company/brand keep passing). `tsc --noEmit` clean.
- [ ] **Step 6: Commit** `fix(inbox): refuse conversion without company/brand; editable inquiry guesses`.

---

### Task 3: Routes — PATCH, Portuguese errors, safeParse

**Files:** Create `src/app/api/commercial-inquiries/[id]/inquiry-errors.ts`, `src/app/api/commercial-inquiries/[id]/route.ts` (+ `route.test.ts`). Modify `convert/route.ts`, `discard/route.ts`, `mark-false-positive/route.ts` and their tests; `src/app/api/id-guard.test.ts` if it enumerates `[id]` routes.

**Consumes:** Task 2 service/errors.

- [ ] **Step 1: Failing tests.**
  - New `route.test.ts` for PATCH (pattern: `convert/route.test.ts` in the same folder): 401 without session; CREATOR session → 403; malformed id → 404 `{ error: "Mensagem não encontrada." }`; other org's inquiry → 404 same body; discarded inquiry → 409 `{ error: "Esta mensagem já foi resolvida." }`; body `{}` → 400 with `errors`; `{ companyName: "x".repeat(201) }` → 400; `{ companyName: "Barbosa Moda" }` → 200 and body `companyGuess === "Barbosa Moda"`; non-JSON body → 400 (not 500).
  - `convert/route.test.ts`: inquiry with no guesses + `{ contact: { fullName: "Rodolfo" } }` → 422 `{ error: "Informe a empresa ou a marca antes de converter.", code: "PARTY_REQUIRED" }`; update the existing 404/409/422 expectations to the Portuguese messages (422 ambiguous gains `code: "AMBIGUOUS_PARTY"`); invalid body `{ contact: {} }` → 400 (not 500).
  - `discard` and `mark-false-positive` tests: already-resolved → 409 "Esta mensagem já foi resolvida."; other org → 404 "Mensagem não encontrada." (add if missing).
  Run → FAIL.
- [ ] **Step 2: Shared mapper** `inquiry-errors.ts`:
```ts
import { NextResponse } from "next/server";
import {
  AmbiguousPartyGuessError,
  InquiryAlreadyResolvedError,
  InquiryNotFoundError,
  InquiryPartyRequiredError,
  InvalidOpportunityPartyError,
} from "@/domain/commercial-flow/errors";

export const INQUIRY_NOT_FOUND = "Mensagem não encontrada.";
const PARTY_REQUIRED = "Informe a empresa ou a marca antes de converter.";

export function inquiryNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: INQUIRY_NOT_FOUND }, { status: 404 });
}

/** Maps inquiry domain errors to user-facing Portuguese responses; null = not an inquiry error (rethrow). */
export function inquiryErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof InquiryNotFoundError) return inquiryNotFoundResponse();
  if (error instanceof InquiryAlreadyResolvedError) {
    return NextResponse.json({ error: "Esta mensagem já foi resolvida." }, { status: 409 });
  }
  if (error instanceof AmbiguousPartyGuessError) {
    return NextResponse.json(
      { error: "Mais de uma empresa ou marca com esse nome — selecione a correta.", code: "AMBIGUOUS_PARTY" },
      { status: 422 },
    );
  }
  if (error instanceof InquiryPartyRequiredError || error instanceof InvalidOpportunityPartyError) {
    return NextResponse.json({ error: PARTY_REQUIRED, code: "PARTY_REQUIRED" }, { status: 422 });
  }
  return null;
}
```
- [ ] **Step 3: PATCH** `src/app/api/commercial-inquiries/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { denyCreatorWrite } from "@/lib/auth/access";
import { isUuid } from "@/lib/uuid";
import { inquiryErrorResponse, inquiryNotFoundResponse } from "./inquiry-errors";

const field = z.string().max(200, "Use no máximo 200 caracteres.").nullable().optional();
const bodySchema = z
  .object({ contactName: field, companyName: field, brandName: field })
  .refine((value) => Object.values(value).some((v) => v !== undefined), { message: "Informe ao menos um campo." });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) return inquiryNotFoundResponse();

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error) }, { status: 400 });
  }

  try {
    const inquiry = await CommercialInquiryService.updateGuesses(db, session.organizationId, id, parsed.data);
    return NextResponse.json(inquiry, { status: 200 });
  } catch (error) {
    const mapped = inquiryErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
```
(Check that the length is validated on the trimmed value — use `z.string().trim().max(...)` if zod 4 supports trim-before-max in this codebase's usage; the service trims again either way.)
- [ ] **Step 4: Existing routes.** In `convert/route.ts`: replace `bodySchema.parse(await request.json())` with `safeParse(await request.json().catch(() => null))` → 400 `{ errors: z.flattenError(parsed.error) }`; replace the 404 for malformed id with `inquiryNotFoundResponse()`; replace the catch body with `const mapped = inquiryErrorResponse(error); if (mapped) return mapped; throw error;`. In `discard/route.ts` and `mark-false-positive/route.ts`: malformed id → `inquiryNotFoundResponse()`; wrap the service call in the same try/catch with `inquiryErrorResponse`.
- [ ] **Step 5:** Run `src/app/api/commercial-inquiries src/app/api/write-guard.test.ts src/app/api/id-guard.test.ts` → PASS (the PATCH calls `denyCreatorWrite(`, so no allowlist change). `tsc --noEmit` clean.
- [ ] **Step 6: Commit** `fix(api): inquiry PATCH, Portuguese errors and safe body parsing`.

---

### Task 4: Inbox panel — Dados block, edit, convert handling

**Files:** Modify `src/hooks/use-inquiry-mutations.ts` (+ test), `src/components/inbox/inquiry-side-panel.tsx` (+ `inquiry-side-panel.test.tsx`).

**Consumes:** PATCH route (Task 3), `ApiError.body` with `code`, `CommercialInquiryListItem` (src/hooks/use-commercial-inquiries.ts).

- [ ] **Step 1: Hook** — add to `use-inquiry-mutations.ts`:
```ts
export interface UpdateInquiryGuessesInput {
  inquiryId: string;
  contactName?: string | null;
  companyName?: string | null;
  brandName?: string | null;
}

export function useUpdateInquiryGuesses(
  creatorId: string,
  status: InquiryStatus,
): UseMutationResult<CommercialInquiryListItem, ApiError, UpdateInquiryGuessesInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inquiryId, ...fields }) =>
      apiFetch<CommercialInquiryListItem>(`/api/commercial-inquiries/${inquiryId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commercialInquiriesQueryKey(creatorId, status) });
    },
  });
}
```
(The PATCH response is the raw inquiry row, without message fields — the panel merges only the three guess fields from it.) Hook test: calls PATCH with the JSON body and invalidates the list key (pattern: the existing tests in `use-inquiry-mutations.test.tsx`).
- [ ] **Step 2: Failing panel tests** (`inquiry-side-panel.test.tsx`, following its existing mocks):
  - NEW inquiry with all guesses null → "Dados" block shows "Contato", "Empresa", "Marca" each with "—" and a button "Editar dados".
  - "Editar dados" → inputs labelled "Contato", "Empresa", "Marca" prefilled with current values; typing "Barbosa Moda" in Empresa and clicking "Salvar" calls the update mutation with `{ inquiryId, contactName: <current or null>, companyName: "Barbosa Moda", brandName: <current or null> }`; on success toast "Dados atualizados." and the block shows "Barbosa Moda"; "Cancelar" closes without calling.
  - Convert sends `contact: { fullName: "Rodolfo Barbosa" }` when `contactNameGuess` is null and `externalContactLabel` is "Rodolfo Barbosa".
  - Convert rejected with `new ApiError(422, "Informe a empresa ou a marca antes de converter.", { code: "PARTY_REQUIRED" })` → toast.error with that message and the edit inputs appear.
  - Convert rejected with 422 `{ code: "AMBIGUOUS_PARTY" }` → the existing select-existing form (`InquiryEditForm`) appears (current behavior).
  - Other error → toast.error(error.message).
  - readOnly or non-NEW inquiry → no "Editar dados".
  Run → FAIL.
- [ ] **Step 3: Implement** in `inquiry-side-panel.tsx`:
  - `const updateGuesses = useUpdateInquiryGuesses(creatorId, status);`
  - state: `const [overrides, setOverrides] = React.useState<Pick<CommercialInquiryListItem, "contactNameGuess" | "companyGuess" | "brandGuess"> | null>(null);` and `const [editingData, setEditingData] = React.useState(false);` — both reset in the existing `useEffect` keyed on `inquiry?.id` (alongside `setEditMode(false)`).
  - `const current = inquiry ? { ...inquiry, ...(overrides ?? {}) } : null;` and use `current` for the displayed guesses and the convert contact.
  - convert contact: `{ fullName: current.contactNameGuess ?? current.externalContactLabel ?? "Desconhecido" }`.
  - convert onError:
```ts
        onError: (error) => {
          const code = error instanceof ApiError ? (error.body as { code?: string } | null)?.code : undefined;
          if (code === "PARTY_REQUIRED") {
            toast.error(error.message);
            setEditingData(true);
            return;
          }
          if (code === "AMBIGUOUS_PARTY") {
            toast.error(error.message);
            setEditMode(true);
            return;
          }
          toast.error(error.message);
        },
```
  - Dados block (only when `!readOnly && current.status === "NEW"`), rendered above the actions:
```tsx
          <section aria-label="Dados" className="mt-4 flex flex-col gap-2 text-sm">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Dados</h3>
            {editingData ? (
              <InquiryDataForm
                initial={current}
                pending={updateGuesses.isPending}
                onCancel={() => setEditingData(false)}
                onSave={(values) =>
                  updateGuesses.mutate(
                    { inquiryId: current.id, ...values },
                    {
                      onSuccess: (updated) => {
                        setOverrides({
                          contactNameGuess: updated.contactNameGuess,
                          companyGuess: updated.companyGuess,
                          brandGuess: updated.brandGuess,
                        });
                        setEditingData(false);
                        toast.success("Dados atualizados.");
                      },
                      onError: (error) => toast.error(error.message),
                    },
                  )
                }
              />
            ) : (
              <>
                <p><span className="text-muted-foreground">Contato: </span>{current.contactNameGuess ?? "—"}</p>
                <p><span className="text-muted-foreground">Empresa: </span>{current.companyGuess ?? "—"}</p>
                <p><span className="text-muted-foreground">Marca: </span>{current.brandGuess ?? "—"}</p>
                <div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditingData(true)}>
                    Editar dados
                  </Button>
                </div>
              </>
            )}
          </section>
```
  - Remove the old "Empresa (IA)" / "Marca (IA)" lines for NEW inquiries (they're now in Dados); keep them for readOnly/non-NEW views; keep Orçamento/Intenção lines.
  - `InquiryDataForm` — small component in the same file (or `src/components/inbox/inquiry-data-form.tsx` if the panel file gets long):
```tsx
function InquiryDataForm({
  initial,
  pending,
  onCancel,
  onSave,
}: {
  initial: { contactNameGuess: string | null; companyGuess: string | null; brandGuess: string | null };
  pending: boolean;
  onCancel: () => void;
  onSave: (values: { contactName: string | null; companyName: string | null; brandName: string | null }) => void;
}) {
  const [contactName, setContactName] = React.useState(initial.contactNameGuess ?? "");
  const [companyName, setCompanyName] = React.useState(initial.companyGuess ?? "");
  const [brandName, setBrandName] = React.useState(initial.brandGuess ?? "");
  const toValue = (value: string) => (value.trim() === "" ? null : value.trim());
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ contactName: toValue(contactName), companyName: toValue(companyName), brandName: toValue(brandName) });
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Contato
        <Input value={contactName} maxLength={200} onChange={(event) => setContactName(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Empresa
        <Input value={companyName} maxLength={200} onChange={(event) => setCompanyName(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Marca
        <Input value={brandName} maxLength={200} onChange={(event) => setBrandName(event.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          Salvar
        </Button>
      </div>
    </form>
  );
}
```
  (`Input` from `@/components/ui/input`.) Note: the inbox has keyboard shortcuts (`use-inbox-shortcuts.ts`) — make sure typing in these inputs doesn't trigger them (check how the hook ignores inputs; if it doesn't, add a test and ignore events whose target is an input/textarea).
- [ ] **Step 4:** Run hook + panel tests, then the full suite once and the build (`OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build`) → green; `tsc --noEmit` clean.
- [ ] **Step 5: Commit** `fix(inbox): edit message data before converting`.

---

## Real verification (controller, after Task 4)

Local dev: register a manual message in the Inbox whose text has no company/brand (e.g. "Queria fazer um orçamento para divulgação da minha marca contigo."); click "Converter em Opportunity" → toast "Informe a empresa ou a marca antes de converter." and the edit inputs open; fill Empresa, Salvar → "Dados atualizados."; Converter → success and the opportunity appears in the Pipeline. Then after deploy, the user repeats it in production with the "Rodolfo Barbosa" message.

## Deploy

No migration, no env vars. User pushes `main`.
