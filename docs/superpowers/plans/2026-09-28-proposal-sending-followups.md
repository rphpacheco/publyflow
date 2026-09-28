# Proposal Sending Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three follow-ups from the proposal-sending spec:
- a malformed `[id]` returns 404 instead of 500 on every `[id]` route;
- the public response form shows server validation errors under each field;
- the builder's send button re-checks the send-state before deciding whether to confirm or send.

**Architecture:**
- A pure `isUuid` helper replaces 4 duplicated regexes and guards all 21 `[id]` route files. A single table-driven test covers them all.
- The public view maps a 400's `errors` to per-field messages rendered by `ResponseDialog`.
- `ProposalSendPanel` awaits the send-state query's `refetch()` before deciding.

**Tech Stack:** Next.js 16 route handlers, React 19, TanStack Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-28-proposal-sending-followups-design.md`

## Global Constraints

- **Next.js docs:** Next.js 16 — read `node_modules/next/dist/docs/` before changing route handlers (AGENTS.md).
- **UUID pattern:** `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, case-insensitive.
- **Route order:** session (401) → `isUuid(id)` (404) → everything else. The guard runs before any DB query or body read.
- **Guard 404 body:** the route's own "not found" body, as listed in Task 1's table.
- **Public form copy:**
  - the general 400 message stays `Confira os dados informados.`;
  - field errors show the first zod message for `name`, `email` or `message`, directly under that field.
- **Refetch failure toast:** `Não foi possível verificar o estado da proposta. Tente novamente.`
- **DB:** no database or migration changes; implementers never touch a DB outside the Vitest suite.
- **Commands:**
  - pnpm: `/opt/homebrew/bin/pnpm`;
  - full suite: `/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000`;
  - build: `OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build`.
- **Commits:** end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, whatever model you are.
- **Worktree shell:** run plain single commands (no chained git/pnpm with variables, no `cd` elsewhere). Quote paths containing `[id]`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/uuid.ts` | `isUuid` |
| 21 `src/app/api/**/[id]/**/route.ts` files | guard |
| `src/app/api/id-guard.test.ts` | table-driven 404 test for every guarded handler |
| `src/components/presentation/response-dialog.tsx` | renders per-field errors |
| `src/components/presentation/public-proposal-view.tsx` | maps a 400's `errors` to field errors |
| `src/components/proposals/proposal-send-panel.tsx` | refetch before deciding |

---

### Task 1: `isUuid` guard on every `[id]` route

**Files:**
- Create: `src/lib/uuid.ts`, `src/lib/uuid.test.ts`, `src/app/api/id-guard.test.ts`
- Modify: the 21 route files in the table below

**Interfaces:**
- Produces: `isUuid(value: string): boolean` from `src/lib/uuid.ts`.

Guard table. `id` below is the route param. Every listed method gets the guard.

| Route file (under `src/app/api/`) | Methods | 404 body when `!isUuid(id)` |
|---|---|---|
| `companies/[id]/route.ts` | GET | `` { error: `Company ${id} not found` } `` |
| `contacts/[id]/route.ts` | GET | `` { error: `Contact ${id} not found` } `` |
| `leads/[id]/route.ts` | GET | `` { error: `Lead ${id} not found` } `` |
| `opportunities/[id]/route.ts` | GET, PATCH | `{ error: new OpportunityNotFoundError(id).message }` (from `@/domain/commercial-flow/errors`, as the file already imports) |
| `commercial-inquiries/[id]/convert/route.ts` | POST | `{ error: new InquiryNotFoundError(id).message }` (`@/domain/commercial-flow/errors`) |
| `commercial-inquiries/[id]/discard/route.ts` | POST | `{ error: new InquiryNotFoundError(id).message }` |
| `commercial-inquiries/[id]/mark-false-positive/route.ts` | POST | `{ error: new InquiryNotFoundError(id).message }` |
| `proposals/[id]/route.ts` | GET, PATCH | `{ error: new ProposalNotFoundError(id).message }` (`@/domain/proposals/errors`) |
| `proposals/[id]/blocks/route.ts` | GET, POST | `{ error: new ProposalNotFoundError(id).message }` |
| `proposals/[id]/items/route.ts` | GET, POST | `{ error: new ProposalNotFoundError(id).message }` |
| `proposals/[id]/versions/route.ts` | GET | `{ error: new ProposalNotFoundError(id).message }` |
| `proposals/[id]/publications/route.ts` | POST, GET | already guarded — replace `UUID_RE.test(id)` with `isUuid(id)`, keep its body |
| `proposals/[id]/send-state/route.ts` | GET | already guarded — same replacement |
| `proposals/[id]/share-info/route.ts` | GET | already guarded — same replacement |
| `notifications/[id]/route.ts` | PATCH | already guarded — same replacement (`{ error: "Notificação não encontrada." }`) |
| `proposal-blocks/[id]/route.ts` | PATCH, DELETE | `{ error: "Não encontrado." }` (its error class needs two ids) |
| `proposal-items/[id]/route.ts` | PATCH, DELETE | `{ error: "Não encontrado." }` |
| `rate-card-items/[id]/route.ts` | PATCH, DELETE | `{ error: "Não encontrado." }` |
| `rate-cards/[id]/duplicate/route.ts` | POST | `{ error: new RateCardNotFoundError(id).message }` (`@/domain/rate-cards/errors`) |
| `rate-cards/[id]/items/route.ts` | POST | `{ error: new RateCardNotFoundError(id).message }` |
| `services/[id]/route.ts` | PATCH | `{ error: new ServiceNotFoundError(id).message }` (`@/domain/rate-cards/errors`) |

`discard`, `duplicate` and `versions` have no 404 today; they use their resource's domain "not found" error, which the spec's "same body the route returns when the resource doesn't exist" means for them.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/uuid.test.ts
import { describe, it, expect } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts lower- and upper-case UUIDs", () => {
    expect(isUuid("2fb4820a-6d42-4d72-bdee-256c8d6189d2")).toBe(true);
    expect(isUuid("2FB4820A-6D42-4D72-BDEE-256C8D6189D2")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("abc")).toBe(false);
    expect(isUuid("2fb4820a6d424d72bdee256c8d6189d2")).toBe(false);
    expect(isUuid("2fb4820a-6d42-4d72-bdee-256c8d6189d2a")).toBe(false);
    expect(isUuid(" 2fb4820a-6d42-4d72-bdee-256c8d6189d2")).toBe(false);
  });
});
```

```typescript
// src/app/api/id-guard.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OpportunityNotFoundError, InquiryNotFoundError } from "@/domain/commercial-flow/errors";
import { ProposalNotFoundError } from "@/domain/proposals/errors";
import { RateCardNotFoundError, ServiceNotFoundError } from "@/domain/rate-cards/errors";

const BAD = "not-a-uuid";
const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";

type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

const cases: Array<{ route: string; load: () => Promise<Record<string, unknown>>; methods: string[]; error: string }> = [
  { route: "companies/[id]", load: () => import("./companies/[id]/route"), methods: ["GET"], error: `Company ${BAD} not found` },
  { route: "contacts/[id]", load: () => import("./contacts/[id]/route"), methods: ["GET"], error: `Contact ${BAD} not found` },
  { route: "leads/[id]", load: () => import("./leads/[id]/route"), methods: ["GET"], error: `Lead ${BAD} not found` },
  { route: "opportunities/[id]", load: () => import("./opportunities/[id]/route"), methods: ["GET", "PATCH"], error: new OpportunityNotFoundError(BAD).message },
  { route: "commercial-inquiries/[id]/convert", load: () => import("./commercial-inquiries/[id]/convert/route"), methods: ["POST"], error: new InquiryNotFoundError(BAD).message },
  { route: "commercial-inquiries/[id]/discard", load: () => import("./commercial-inquiries/[id]/discard/route"), methods: ["POST"], error: new InquiryNotFoundError(BAD).message },
  { route: "commercial-inquiries/[id]/mark-false-positive", load: () => import("./commercial-inquiries/[id]/mark-false-positive/route"), methods: ["POST"], error: new InquiryNotFoundError(BAD).message },
  { route: "proposals/[id]", load: () => import("./proposals/[id]/route"), methods: ["GET", "PATCH"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/blocks", load: () => import("./proposals/[id]/blocks/route"), methods: ["GET", "POST"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/items", load: () => import("./proposals/[id]/items/route"), methods: ["GET", "POST"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/versions", load: () => import("./proposals/[id]/versions/route"), methods: ["GET"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/publications", load: () => import("./proposals/[id]/publications/route"), methods: ["POST", "GET"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/send-state", load: () => import("./proposals/[id]/send-state/route"), methods: ["GET"], error: new ProposalNotFoundError(BAD).message },
  { route: "proposals/[id]/share-info", load: () => import("./proposals/[id]/share-info/route"), methods: ["GET"], error: new ProposalNotFoundError(BAD).message },
  { route: "notifications/[id]", load: () => import("./notifications/[id]/route"), methods: ["PATCH"], error: "Notificação não encontrada." },
  { route: "proposal-blocks/[id]", load: () => import("./proposal-blocks/[id]/route"), methods: ["PATCH", "DELETE"], error: "Não encontrado." },
  { route: "proposal-items/[id]", load: () => import("./proposal-items/[id]/route"), methods: ["PATCH", "DELETE"], error: "Não encontrado." },
  { route: "rate-card-items/[id]", load: () => import("./rate-card-items/[id]/route"), methods: ["PATCH", "DELETE"], error: "Não encontrado." },
  { route: "rate-cards/[id]/duplicate", load: () => import("./rate-cards/[id]/duplicate/route"), methods: ["POST"], error: new RateCardNotFoundError(BAD).message },
  { route: "rate-cards/[id]/items", load: () => import("./rate-cards/[id]/items/route"), methods: ["POST"], error: new RateCardNotFoundError(BAD).message },
  { route: "services/[id]", load: () => import("./services/[id]/route"), methods: ["PATCH"], error: new ServiceNotFoundError(BAD).message },
];

describe("malformed [id] returns the route's 404, never a 500", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterAll(async () => cleanup?.());

  for (const { route, load, methods, error } of cases) {
    for (const method of methods) {
      it(`${method} /api/${route}`, async () => {
        const { db, cleanup: c } = await withTestDb();
        cleanup = c;
        const handlers = await importRouteWithSession(load, { db, session: ownerSession(ORG, USER) });
        const handler = handlers[method] as Handler;
        const init: RequestInit = { method };
        if (method !== "GET" && method !== "DELETE") {
          init.headers = { "content-type": "application/json" };
          init.body = "{}";
        }
        const response = await handler(new Request(`http://localhost/api/${route.replace("[id]", BAD)}`, init), {
          params: Promise.resolve({ id: BAD }),
        });

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error });
      });
    }
  }

  it("still answers 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { GET } = (await importRouteWithSession(() => import("./proposals/[id]/route"), { db, session: null })) as {
      GET: Handler;
    };
    const response = await GET(new Request(`http://localhost/api/proposals/${BAD}`), { params: Promise.resolve({ id: BAD }) });
    expect(response.status).toBe(401);
  });
});
```

Check `importRouteWithSession`'s real signature in `src/test/helpers/route.ts` and adapt the generic/cast if needed. Confirm the exact 404 text of the three template-literal routes against their files. If a handler's context type differs (e.g. `params: Promise<{ id: string; ... }>`), keep the call shape and cast.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/uuid.test.ts src/app/api/id-guard.test.ts`
Expected: `uuid.test.ts` fails (module missing). Most `id-guard` cases fail with status 500 or a thrown Postgres `22P02`. The four already-guarded routes pass.

- [ ] **Step 3: Implement**

```typescript
// src/lib/uuid.ts
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids reach Postgres `uuid` columns; a malformed one must be a 404, not a 22P02 → 500. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
```

In each route file and method from the table, right after `const { id } = await params;`, and after the existing session check:

```typescript
  if (!isUuid(id)) {
    return NextResponse.json({ error: new ProposalNotFoundError(id).message }, { status: 404 });
  }
```

Use the body from the table for that route. Add `import { isUuid } from "@/lib/uuid";` and any error-class import the file doesn't already have. If a handler reads `params` after reading the body, move `await params` and the guard up so the guard runs before the body is read. In the four already-guarded files, delete the local `UUID_RE` constant and use `isUuid(id)`, leaving each file's behaviour unchanged.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/lib/uuid.test.ts src/app/api/id-guard.test.ts
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/lib/uuid.ts src/lib/uuid.test.ts src/app/api
git commit -m "fix: answer 404 instead of 500 for malformed [id] route params"
```

---

### Task 2: Per-field server errors on the public response form

**Files:**
- Modify: `src/components/presentation/response-dialog.tsx`, `src/components/presentation/public-proposal-view.tsx`
- Test: `src/components/presentation/public-proposal-view.test.tsx` (add cases)

**Interfaces:**
- Produces:
  - `export type ResponseFieldErrors = Partial<Record<"name" | "email" | "message", string>>` from `response-dialog.tsx`;
  - `ResponseDialog` gains props `fieldErrors: ResponseFieldErrors` and `onFieldEdit: (field: keyof ResponseFieldErrors) => void`.

- [ ] **Step 1: Write the failing tests**

Add to `public-proposal-view.test.tsx`, inside the existing `describe`. It reuses `renderView`, `userEvent` and `screen`.

```typescript
  async function acceptWith(name: string, email: string) {
    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    await userEvent.type(screen.getByLabelText("Nome"), name);
    await userEvent.type(screen.getByLabelText("E-mail"), email);
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
  }

  it("400 with a field error shows it under the field, marks it invalid, and hides the general message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: { email: ["E-mail inválido."] } }), { status: 400 }),
    );
    renderView();
    await acceptWith("Maria", "maria@bella");

    expect(await screen.findByText("E-mail inválido.")).toBeInTheDocument();
    const email = screen.getByLabelText("E-mail");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("E-mail inválido.");
    expect(screen.getByLabelText("Nome")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Confira os dados informados.")).not.toBeInTheDocument();
  });

  it("editing a field clears only that field's server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: { name: ["Informe seu nome."], email: ["E-mail inválido."] } }), { status: 400 }),
    );
    renderView();
    await acceptWith("M", "maria@bella");
    await screen.findByText("E-mail inválido.");

    await userEvent.type(screen.getByLabelText("E-mail"), ".test");
    expect(screen.queryByText("E-mail inválido.")).not.toBeInTheDocument();
    expect(screen.getByText("Informe seu nome.")).toBeInTheDocument();
  });

  it("400 without visible-field errors keeps the general message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: { publicationId: ["Invalid UUID"] } }), { status: 400 }),
    );
    renderView();
    await acceptWith("Maria", "maria@bella.test");
    expect(await screen.findByText("Confira os dados informados.")).toBeInTheDocument();
  });

  it("a new submit clears previous server errors", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: { email: ["E-mail inválido."] } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "x" }), { status: 500 }));
    renderView();
    await acceptWith("Maria", "maria@bella");
    await screen.findByText("E-mail inválido.");

    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Não foi possível registrar sua resposta. Tente novamente.")).toBeInTheDocument();
    expect(screen.queryByText("E-mail inválido.")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/components/presentation/public-proposal-view.test.tsx`
Expected: the 4 new cases FAIL.

- [ ] **Step 3: Implement**

In `response-dialog.tsx`:

```typescript
export type ResponseFieldErrors = Partial<Record<"name" | "email" | "message", string>>;
```

Add props `fieldErrors: ResponseFieldErrors` and `onFieldEdit: (field: keyof ResponseFieldErrors) => void`. For each field:
- call `onFieldEdit("<field>")` in its `onChange`, alongside the existing setter;
- set `aria-invalid={fieldErrors.<field> ? true : undefined}` and `aria-describedby={fieldErrors.<field> ? "response-<field>-error" : undefined}` on the `Input`/`Textarea`;
- directly after the `<label>` element, render

```tsx
{fieldErrors.email ? (
  <p id="response-email-error" className="text-xs text-error">
    {fieldErrors.email}
  </p>
) : null}
```

with the matching field name and id (`response-name-error`, `response-email-error`, `response-message-error`). The message field only renders when `copy?.messageLabel` is set; keep that condition and put its error inside the same conditional.

In `public-proposal-view.tsx`:
- add state `const [fieldErrors, setFieldErrors] = React.useState<ResponseFieldErrors>({});`;
- at the start of the submit handler, where it sets pending, call `setFieldErrors({})` next to the existing server-error reset;
- widen the parsed error body type to `{ code?: string; errors?: Record<string, string[] | undefined> }`;
- replace the `result.status === 400` branch with:

```typescript
      } else if (result.status === 400) {
        const visible: ResponseFieldErrors = {};
        for (const field of ["name", "email", "message"] as const) {
          const first = body.errors?.[field]?.[0];
          if (first) visible[field] = first;
        }
        if (Object.keys(visible).length > 0) {
          setFieldErrors(visible);
        } else {
          setServerError({ message: "Confira os dados informados.", reload: false });
        }
```

- pass `fieldErrors={fieldErrors}` and `onFieldEdit={(field) => setFieldErrors(({ [field]: _removed, ...rest }) => rest)}` to `ResponseDialog`;
- when the dialog closes (the existing `onOpenChange` path that resets the action), also call `setFieldErrors({})`.

If the view doesn't reset the server error at submit start today, read the file and do both resets wherever the request is initiated. The test "a new submit clears previous server errors" is the contract.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/components/presentation
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/components/presentation
git commit -m "feat: show server validation errors under each field on the public response form"
```

---

### Task 3: Re-check the send-state before sending

**Files:**
- Modify: `src/components/proposals/proposal-send-panel.tsx`
- Test: `src/components/proposals/proposal-send-panel.test.tsx`

**Interfaces:**
- Consumes: `useProposalSendState(proposalId)` from `@/hooks/use-proposal-sending`, a TanStack `UseQueryResult<SendStateDto>` with `refetch(): Promise<{ data?: SendStateDto; isError: boolean }>`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

In `proposal-send-panel.test.tsx`:
- replace the hook mock with one exposing `refetch`:

```typescript
let sendState: SendStateDto | undefined;
let freshState: SendStateDto | undefined;
let refetchFails = false;
const mutateMock = vi.fn();
const refetchMock = vi.fn(async () =>
  refetchFails ? { data: undefined, isError: true } : { data: freshState ?? sendState, isError: false },
);
vi.mock("@/hooks/use-proposal-sending", () => ({
  useProposalSendState: () => ({ data: sendState, isLoading: false, refetch: refetchMock }),
  usePublishProposal: () => ({ mutate: mutateMock, isPending: false }),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) } }));
```

- extend `beforeEach` with `refetchMock.mockClear(); toastError.mockReset(); freshState = undefined; refetchFails = false;`;
- add:

```typescript
  it("re-checks the state before sending and confirms when the client answered meanwhile", async () => {
    sendState = state({ status: "SENT", publicPath: "/p/tok", latestPublication: published, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    freshState = state({ status: "APPROVED", publicPath: "/p/tok", latestPublication: accepted, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Abrir nova rodada?")).toBeInTheDocument();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("sends without confirmation when the fresh state still allows it", async () => {
    sendState = state({ status: "SENT", publicPath: "/p/tok", latestPublication: published, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledTimes(1);
  });

  it("does not send when the fresh state can no longer send", async () => {
    sendState = state({ status: "SENT", publicPath: "/p/tok", latestPublication: published, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    freshState = { ...sendState, canSend: false };
    render(<ProposalSendPanel proposalId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Abrir nova rodada?")).not.toBeInTheDocument();
  });

  it("shows a toast and does not send when the re-check fails", async () => {
    sendState = state({});
    refetchFails = true;
    render(<ProposalSendPanel proposalId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: "Enviar proposta" }));

    expect(toastError).toHaveBeenCalledWith("Não foi possível verificar o estado da proposta. Tente novamente.");
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("disables the send button while re-checking", async () => {
    sendState = state({});
    let release!: () => void;
    refetchMock.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ data: sendState, isError: false }))),
    );
    render(<ProposalSendPanel proposalId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: "Enviar proposta" }));
    expect(screen.getByRole("button", { name: "Enviar proposta" })).toBeDisabled();
    release();
    await vi.waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
  });
```

The existing APPROVED and REJECTED confirmation tests keep working, because the refetch returns the same `sendState` when `freshState` is unset. If an existing test awaited `mutateMock` synchronously after a click, wrap its assertion in `await vi.waitFor(...)`, since sending is now async.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/components/proposals/proposal-send-panel.test.tsx`
Expected: the new cases FAIL (`refetch` is never called).

- [ ] **Step 3: Implement**

In `proposal-send-panel.tsx`:
- `const sendStateQuery = useProposalSendState(proposalId); const state = sendStateQuery.data;` (replacing the destructure);
- add `const [checking, setChecking] = React.useState(false);`;
- replace `onSendClick`:

```typescript
  // Decide on the server's current state, not the one loaded with the page:
  // the client may have accepted or rejected since.
  async function onSendClick() {
    setChecking(true);
    try {
      const result = await sendStateQuery.refetch();
      const fresh = result.data;
      if (result.isError || !fresh) {
        toast.error("Não foi possível verificar o estado da proposta. Tente novamente.");
        return;
      }
      if (!fresh.canSend) return;
      if (CONFIRM_COPY[fresh.status]) {
        setConfirming(true);
      } else {
        send();
      }
    } finally {
      setChecking(false);
    }
  }
```

- the send button's `disabled` becomes `!state.canSend || publish.isPending || checking`.

The confirmation dialog keeps reading `CONFIRM_COPY[state.status]`. After the refetch, the query cache holds the fresh state, so the panel re-renders with it.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/components/proposals
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/components/proposals
git commit -m "fix: re-check the send-state before resending a proposal"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 per-field errors, general fallback, clear on edit and resubmit, ARIA | 2 |
| §2 `isUuid`, 4 copies removed, 17 routes guarded, order 401 → 404, per-route bodies, tests | 1 |
| §3 refetch-then-decide, `canSend` false, confirm on APPROVED or REJECTED, toast on failure, disabled while checking | 3 |
| §4 tests | 1–3 |

**Placeholder scan:** every code step has concrete code. Two adaptations are flagged: the real `importRouteWithSession` signature, and where the view resets errors.

**Type consistency:** `isUuid` is defined in Task 1 and used only there. `ResponseFieldErrors` and `onFieldEdit` are defined and consumed within Task 2. Task 3 uses only the existing hook.
