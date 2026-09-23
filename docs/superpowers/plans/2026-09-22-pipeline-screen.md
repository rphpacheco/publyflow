# Pipeline Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Pipeline screen at `/pipeline` — a 10-column Kanban board with drag-and-drop
stage changes — consuming the fully-ready backend and the Design System + Inbox conventions
already established.

**Architecture:** One cohesive plan (not split from a separate "drag-and-drop foundation"
plan) — `@dnd-kit/core` genuinely has no other consumer in this codebase yet, so isolating it
as its own plan would produce infrastructure with nothing to demonstrate it works; building it
alongside the one screen that uses it keeps every task independently testable while avoiding
a plan nobody can verify end-to-end. Data fetching follows the exact TanStack Query hook
pattern established by the Inbox screen (`src/hooks/use-commercial-inquiries.ts`,
`src/hooks/use-inquiry-mutations.ts`) — same `apiFetch`/`ApiError`, same query-key-builder
convention. `OpportunityCard`/`OpportunityColumn` are dnd-kit-aware but degrade safely without
a `DndContext` ancestor (dnd-kit's `useDraggable`/`useDroppable` return inert no-ops outside a
provider — used deliberately here so the same column component works in both the desktop
drag-enabled board and the mobile non-drag board without duplicating column-rendering logic).

**Tech Stack:** Next.js 16 (Client Components), React 19, `@tanstack/react-query`,
`@dnd-kit/core` (new dependency, first use in this codebase), existing Design System
primitives (`Button`, `Card`, `Sheet`, `Select`, `DropdownMenu`, `EmptyState`, `sonner`),
Vitest + `@testing-library/react`.

## Global Constraints

- **`stage` vs `status` contract**: the UI only ever reads and writes `stage`. It never reads,
  sends, or attempts to keep `status` (`OPEN`/`WON`/`LOST`) in sync — the backend already does
  that automatically (`OpportunitiesRepository.updateStage`, merged) when `stage` reaches
  `FECHADO`/`PERDIDO`. No task in this plan touches `status`.
- **Optimistic update + rollback**: dragging a card (or using "Mover para...") updates the
  local TanStack Query cache immediately, then fires `PATCH /api/opportunities/:id`. On
  success, the optimistic state stands (confirmed by a background refetch). On failure, the
  cache rolls back to its pre-drag snapshot and a toast shows the error. The mutation never
  waits for the PATCH to resolve before moving the card visually.
- **No persisted card order**: there is no `sort_order`/position column on `opportunities`.
  Drag-and-drop changes `stage` only, never a manual position within a column. After any
  refetch (including the mutation's own `onSettled`), ordering reverts to `createdAt desc` —
  the same ordering `GET /api/opportunities` already returns.
- **Side Panel uses already-loaded data**: `OpportunitySidePanel` renders whatever the list
  query already has in cache — it never calls `GET /api/opportunities/:id` (that endpoint
  isn't enriched with company/brand/contact names, and this plan doesn't touch it).
- **No stage-transition validation**: any stage → any stage is valid, exactly as the backend
  allows. No task adds a transition rule.
- **Mobile has no drag**: per the Design System v1's Kanban rule (one column at a time,
  navigated horizontally, no alternative view), mobile never wires `DndContext`/sensors — the
  only way to change stage on mobile is the "Mover para..." action.
- **No new Design System primitives** — `Button`, `Card`, `Sheet`, `Select`, `DropdownMenu`,
  `EmptyState` all already exist and are reused as-is. The only new dependency is
  `@dnd-kit/core` (not yet installed — the Design System v1 plan deferred it, it was never
  pre-installed).
- **`@dnd-kit/core` is genuinely new**: verify with `grep -rn "dnd-kit" package.json` before
  starting Task 4 that it's still absent; if a prior task in a different branch already added
  it, adjust Task 4 to skip the install step rather than reinstalling.

---

### Task 1: Shared stage metadata + formatting helpers

**Files:**
- Create: `src/lib/opportunity-stages.ts`
- Create: `src/lib/format.ts`
- Modify: `src/components/inbox/inquiry-list.tsx`
- Test: `src/lib/opportunity-stages.test.ts`
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Produces: `OpportunityStage` type (the 10-value union), `STAGES: OpportunityStage[]`
  (ordered array, `NOVO_LEAD` first through `PERDIDO` last — the pipeline's natural order),
  `STAGE_LABELS: Record<OpportunityStage, string>` (Portuguese display labels) from
  `src/lib/opportunity-stages.ts` — consumed by every later task in this plan.
- Produces: `relativeTime(iso: string): string` and `formatCurrencyBRL(cents: number): string`
  from `src/lib/format.ts`. `relativeTime` is extracted from `src/components/inbox/inquiry-list.tsx`
  (which already has an identical private function) rather than duplicated — this task also
  refactors that file to import it instead.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/opportunity-stages.test.ts
import { describe, it, expect } from "vitest";
import { STAGES, STAGE_LABELS } from "./opportunity-stages";

describe("opportunity stages", () => {
  it("lists all 10 stages in pipeline order", () => {
    expect(STAGES).toEqual([
      "NOVO_LEAD",
      "QUALIFICACAO",
      "PRIMEIRO_CONTATO",
      "MIDIA_KIT_ENVIADO",
      "PROPOSTA_SOLICITADA",
      "PROPOSTA_ENVIADA",
      "NEGOCIACAO",
      "AGUARDANDO_CLIENTE",
      "FECHADO",
      "PERDIDO",
    ]);
  });

  it("has a Portuguese label for every stage", () => {
    for (const stage of STAGES) {
      expect(STAGE_LABELS[stage]).toBeTruthy();
    }
    expect(STAGE_LABELS.NOVO_LEAD).toBe("Novo Lead");
    expect(STAGE_LABELS.FECHADO).toBe("Fechado");
  });
});
```

```typescript
// src/lib/format.test.ts
import { describe, it, expect } from "vitest";
import { relativeTime, formatCurrencyBRL } from "./format";

describe("relativeTime", () => {
  it("formats a timestamp from a few minutes ago", () => {
    const iso = new Date(Date.now() - 5 * 60000).toISOString();
    expect(relativeTime(iso)).toBe("há 5min");
  });

  it("formats a timestamp from a few hours ago", () => {
    const iso = new Date(Date.now() - 3 * 3600000).toISOString();
    expect(relativeTime(iso)).toBe("há 3h");
  });
});

describe("formatCurrencyBRL", () => {
  it("formats cents as a BRL currency string", () => {
    expect(formatCurrencyBRL(500000)).toBe("R$ 5.000,00");
  });

  it("formats zero cents", () => {
    expect(formatCurrencyBRL(0)).toBe("R$ 0,00");
  });
});
```

Note: `Intl.NumberFormat("pt-BR", {style: "currency", currency: "BRL"})` uses a non-breaking
space (` `) between the currency symbol and the number in Node's ICU data — write the
assertion with the literal ` ` as shown, not a regular space, or the test will fail on a
whitespace mismatch that has nothing to do with your implementation.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/opportunity-stages.test.ts src/lib/format.test.ts`
Expected: FAIL — neither file exists yet.

- [ ] **Step 3: Implement `opportunity-stages.ts`**

```typescript
// src/lib/opportunity-stages.ts
export type OpportunityStage =
  | "NOVO_LEAD"
  | "QUALIFICACAO"
  | "PRIMEIRO_CONTATO"
  | "MIDIA_KIT_ENVIADO"
  | "PROPOSTA_SOLICITADA"
  | "PROPOSTA_ENVIADA"
  | "NEGOCIACAO"
  | "AGUARDANDO_CLIENTE"
  | "FECHADO"
  | "PERDIDO";

export const STAGES: OpportunityStage[] = [
  "NOVO_LEAD",
  "QUALIFICACAO",
  "PRIMEIRO_CONTATO",
  "MIDIA_KIT_ENVIADO",
  "PROPOSTA_SOLICITADA",
  "PROPOSTA_ENVIADA",
  "NEGOCIACAO",
  "AGUARDANDO_CLIENTE",
  "FECHADO",
  "PERDIDO",
];

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  NOVO_LEAD: "Novo Lead",
  QUALIFICACAO: "Qualificação",
  PRIMEIRO_CONTATO: "Primeiro Contato",
  MIDIA_KIT_ENVIADO: "Mídia Kit Enviado",
  PROPOSTA_SOLICITADA: "Proposta Solicitada",
  PROPOSTA_ENVIADA: "Proposta Enviada",
  NEGOCIACAO: "Negociação",
  AGUARDANDO_CLIENTE: "Aguardando Cliente",
  FECHADO: "Fechado",
  PERDIDO: "Perdido",
};
```

- [ ] **Step 4: Implement `format.ts`**

Read the current content of `src/components/inbox/inquiry-list.tsx` in full first — copy its
existing `relativeTime` function body verbatim (don't change its behavior).

```typescript
// src/lib/format.ts
export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.round(hours / 24);
  return `há ${days}d`;
}

export function formatCurrencyBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
}
```

- [ ] **Step 5: Refactor `inquiry-list.tsx` to import `relativeTime`**

Remove the private `relativeTime` function from `src/components/inbox/inquiry-list.tsx` and
add `import { relativeTime } from "@/lib/format";` at the top of the file instead. Do not
change anything else in that file — this is a pure extraction, not a behavior change.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/opportunity-stages.test.ts src/lib/format.test.ts src/components/inbox/inquiry-list.test.tsx`
Expected: PASS — the new tests pass, and `inquiry-list.test.tsx`'s existing tests (which
exercise the relative-time rendering) still pass unchanged, proving the extraction preserved
behavior.

- [ ] **Step 7: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/lib/opportunity-stages.ts src/lib/opportunity-stages.test.ts src/lib/format.ts src/lib/format.test.ts src/components/inbox/inquiry-list.tsx
git commit -m "feat: add shared opportunity stage metadata and formatting helpers"
```

---

### Task 2: `useOpportunities` query hook

**Files:**
- Create: `src/hooks/use-opportunities.ts`
- Test: `src/hooks/use-opportunities.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`src/lib/api-client.ts`, already merged), `OpportunityStage`
  (Task 1).
- Produces: `OpportunityListItem` type (the wire shape — `id`, `organizationId`, `creatorId`,
  `leadId`, `companyId: string | null`, `brandId: string | null`, `stage: OpportunityStage`,
  `status: "OPEN" | "WON" | "LOST"`, `estimatedValueCents: number | null`, `createdAt: string`,
  `companyName: string | null`, `brandName: string | null`, `contactName: string`) and
  `opportunitiesQueryKey(organizationId, creatorId)` and
  `useOpportunities(organizationId, creatorId, options?: {enabled?: boolean}):
  UseQueryResult<OpportunityListItem[]>` from `src/hooks/use-opportunities.ts`. Unlike the
  Inbox's per-status hook, this fetches **all stages in one request** (no `stage` query
  param) — the Pipeline shows every column at once, grouping happens client-side. Query key
  is `["opportunities", organizationId, creatorId]` — later tasks' mutation invalidates/
  updates this exact key.

- [ ] **Step 1: Write the failing test**

```typescript
// src/hooks/use-opportunities.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOpportunities } from "./use-opportunities";

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe({ organizationId, creatorId }: { organizationId: string; creatorId: string }) {
  const { data, isLoading } = useOpportunities(organizationId, creatorId);
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} opportunities</span>;
}

describe("useOpportunities", () => {
  it("fetches all opportunities for a creator (no stage filter) and requests the right URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "o1", stage: "NOVO_LEAD" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Probe organizationId="org1" creatorId="creator1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 opportunities")).toBeInTheDocument();

    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toContain("organizationId=org1");
    expect(requestedUrl).toContain("creatorId=creator1");
    expect(requestedUrl).not.toContain("stage=");
  });

  it("does not fetch when enabled is false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <DisabledProbe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("disabled")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function DisabledProbe() {
  useOpportunities("org1", "", { enabled: false });
  return <span>disabled</span>;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-opportunities.test.tsx`
Expected: FAIL — `./use-opportunities` doesn't exist.

- [ ] **Step 3: Implement `useOpportunities`**

```typescript
// src/hooks/use-opportunities.ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { OpportunityStage } from "@/lib/opportunity-stages";

export interface OpportunityListItem {
  id: string;
  organizationId: string;
  creatorId: string;
  leadId: string;
  companyId: string | null;
  brandId: string | null;
  stage: OpportunityStage;
  status: "OPEN" | "WON" | "LOST";
  estimatedValueCents: number | null;
  createdAt: string;
  companyName: string | null;
  brandName: string | null;
  contactName: string;
}

export function opportunitiesQueryKey(organizationId: string, creatorId: string) {
  return ["opportunities", organizationId, creatorId] as const;
}

export function useOpportunities(
  organizationId: string,
  creatorId: string,
  options?: { enabled?: boolean },
): UseQueryResult<OpportunityListItem[]> {
  return useQuery({
    queryKey: opportunitiesQueryKey(organizationId, creatorId),
    queryFn: () =>
      apiFetch<OpportunityListItem[]>(
        `/api/opportunities?organizationId=${organizationId}&creatorId=${creatorId}`,
      ),
    enabled: options?.enabled ?? true,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-opportunities.test.tsx`
Expected: PASS (both cases)

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/hooks/use-opportunities.ts src/hooks/use-opportunities.test.tsx
git commit -m "feat: add useOpportunities query hook"
```

---

### Task 3: `useUpdateOpportunityStage` optimistic mutation

**Files:**
- Create: `src/hooks/use-update-opportunity-stage.ts`
- Test: `src/hooks/use-update-opportunity-stage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`/`ApiError` (`src/lib/api-client.ts`), `opportunitiesQueryKey`/
  `OpportunityListItem` (Task 2), `OpportunityStage` (Task 1), `toast` from `sonner`.
- Produces: `UpdateStageInput = {opportunityId: string, stage: OpportunityStage}` and
  `useUpdateOpportunityStage(organizationId, creatorId): UseMutationResult<unknown, ApiError,
  UpdateStageInput>` from `src/hooks/use-update-opportunity-stage.ts`. Implements the
  optimistic-update-plus-rollback contract from Global Constraints: `onMutate` cancels
  in-flight queries for this key, snapshots the current cached list, and writes the new stage
  into the cache immediately; `onError` restores the snapshot and shows an error toast;
  `onSettled` (runs after either outcome) invalidates the query so the next render refetches
  the authoritative, `createdAt desc`-ordered list from the server.

- [ ] **Step 1: Write the failing test**

```typescript
// src/hooks/use-update-opportunity-stage.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUpdateOpportunityStage } from "./use-update-opportunity-stage";
import { opportunitiesQueryKey, type OpportunityListItem } from "./use-opportunities";

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const seedOpportunities: OpportunityListItem[] = [
  {
    id: "o1",
    organizationId: "org1",
    creatorId: "creator1",
    leadId: "lead1",
    companyId: null,
    brandId: null,
    stage: "NOVO_LEAD",
    status: "OPEN",
    estimatedValueCents: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    companyName: null,
    brandName: null,
    contactName: "Maria",
  },
];

describe("useUpdateOpportunityStage", () => {
  it("optimistically moves the opportunity, then keeps the state on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const key = opportunitiesQueryKey("org1", "creator1");
    queryClient.setQueryData(key, seedOpportunities);

    const { result } = renderHook(() => useUpdateOpportunityStage("org1", "creator1"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ opportunityId: "o1", stage: "QUALIFICACAO" });

    // Optimistic: the cache reflects the new stage before the PATCH resolves.
    await waitFor(() => {
      const cached = queryClient.getQueryData<OpportunityListItem[]>(key);
      expect(cached?.[0]?.stage).toBe("QUALIFICACAO");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/opportunities/o1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      stage: "QUALIFICACAO",
    });
  });

  it("rolls back the cache and shows an error toast when the PATCH fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "Opportunity not found" }),
      }),
    );

    const queryClient = new QueryClient();
    const key = opportunitiesQueryKey("org1", "creator1");
    queryClient.setQueryData(key, seedOpportunities);

    const { result } = renderHook(() => useUpdateOpportunityStage("org1", "creator1"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ opportunityId: "o1", stage: "QUALIFICACAO" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<OpportunityListItem[]>(key);
    expect(cached?.[0]?.stage).toBe("NOVO_LEAD");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-update-opportunity-stage.test.tsx`
Expected: FAIL — `./use-update-opportunity-stage` doesn't exist.

- [ ] **Step 3: Implement `useUpdateOpportunityStage`**

```typescript
// src/hooks/use-update-opportunity-stage.ts
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api-client";
import { opportunitiesQueryKey, type OpportunityListItem } from "./use-opportunities";
import type { OpportunityStage } from "@/lib/opportunity-stages";

export interface UpdateStageInput {
  opportunityId: string;
  stage: OpportunityStage;
}

interface MutationContext {
  previous?: OpportunityListItem[];
}

export function useUpdateOpportunityStage(
  organizationId: string,
  creatorId: string,
): UseMutationResult<unknown, ApiError, UpdateStageInput, MutationContext> {
  const queryClient = useQueryClient();
  const queryKey = opportunitiesQueryKey(organizationId, creatorId);

  return useMutation({
    mutationFn: ({ opportunityId, stage }) =>
      apiFetch(`/api/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, stage }),
      }),
    onMutate: async ({ opportunityId, stage }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<OpportunityListItem[]>(queryKey);
      queryClient.setQueryData<OpportunityListItem[]>(queryKey, (old) =>
        old?.map((item) => (item.id === opportunityId ? { ...item, stage } : item)) ?? old,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast.error("Não foi possível mover a oportunidade. Tente novamente.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-update-opportunity-stage.test.tsx`
Expected: PASS (both cases)

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/hooks/use-update-opportunity-stage.ts src/hooks/use-update-opportunity-stage.test.tsx
git commit -m "feat: add useUpdateOpportunityStage optimistic mutation"
```

---

### Task 4: `OpportunityCard`

**Files:**
- Create: `src/components/pipeline/opportunity-card.tsx`
- Test: `src/components/pipeline/opportunity-card.test.tsx`

**Interfaces:**
- Consumes: `OpportunityListItem` (Task 2), `STAGES`/`STAGE_LABELS`/`OpportunityStage`
  (Task 1), `relativeTime`/`formatCurrencyBRL` (Task 1), `Card` (existing, NOT forwardRef —
  see Step 3's note), `Button`/`DropdownMenu`/`DropdownMenuContent`/`DropdownMenuItem`/
  `DropdownMenuTrigger` (existing).
- Produces: `OpportunityCard` from `src/components/pipeline/opportunity-card.tsx` — props
  `{opportunity: OpportunityListItem, onSelect: (opportunity: OpportunityListItem) => void,
  onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void}`. Draggable via
  `@dnd-kit/core`'s `useDraggable` (drag id = `opportunity.id`). Renders the display label
  (`brandName ?? companyName ?? contactName`), formatted value, relative time, and a "Mover
  para..." `DropdownMenu` listing all 10 stages (current stage shown disabled). Consumed by
  `PipelineColumn` (Task 5).

- [ ] **Step 1: Install `@dnd-kit/core`**

First confirm it's still absent (per Global Constraints):

```bash
grep -n "dnd-kit" package.json || echo "confirmed absent"
```

Then install:

```bash
pnpm add @dnd-kit/core
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/components/pipeline/opportunity-card.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpportunityCard } from "./opportunity-card";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

const opportunity: OpportunityListItem = {
  id: "o1",
  organizationId: "org1",
  creatorId: "creator1",
  leadId: "lead1",
  companyId: "c1",
  brandId: null,
  stage: "NOVO_LEAD",
  status: "OPEN",
  estimatedValueCents: 500000,
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  companyName: "Bella Cosméticos",
  brandName: null,
  contactName: "Maria",
};

describe("OpportunityCard", () => {
  it("shows the company as the label when no brand is set, the formatted value, and calls onSelect on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <OpportunityCard opportunity={opportunity} onSelect={onSelect} onMoveToStage={vi.fn()} />,
    );

    expect(screen.getByText("Bella Cosméticos")).toBeInTheDocument();
    expect(screen.getByText("R$ 5.000,00")).toBeInTheDocument();

    await user.click(screen.getByText("Bella Cosméticos"));
    expect(onSelect).toHaveBeenCalledWith(opportunity);
  });

  it("offers 'Mover para...' with all 10 stages, current stage disabled, and calls onMoveToStage", async () => {
    const user = userEvent.setup();
    const onMoveToStage = vi.fn();
    const onSelect = vi.fn();

    render(
      <OpportunityCard opportunity={opportunity} onSelect={onSelect} onMoveToStage={onMoveToStage} />,
    );

    await user.click(screen.getByRole("button", { name: "Mover para..." }));

    const currentStageItem = await screen.findByRole("menuitem", { name: "Novo Lead" });
    expect(currentStageItem).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("menuitem", { name: "Qualificação" }));
    expect(onMoveToStage).toHaveBeenCalledWith("o1", "QUALIFICACAO");
    // Clicking the menu item must not also trigger the card's own onSelect.
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/components/pipeline/opportunity-card.test.tsx`
Expected: FAIL — `./opportunity-card` doesn't exist.

- [ ] **Step 4: Implement `OpportunityCard`**

`src/components/ui/card.tsx`'s `Card` is a plain function component, not `React.forwardRef` —
it cannot receive a `ref` directly. dnd-kit's `useDraggable` needs a DOM node ref to attach
listeners to, so wrap `Card` in a plain `<div>` that holds the ref, rather than modifying the
shared `Card` primitive (out of scope for this task — it's used by many already-merged
screens).

```typescript
// src/components/pipeline/opportunity-card.tsx
"use client";

import { useDraggable } from "@dnd-kit/core";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { relativeTime, formatCurrencyBRL } from "@/lib/format";
import { STAGES, STAGE_LABELS, type OpportunityStage } from "@/lib/opportunity-stages";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

export interface OpportunityCardProps {
  opportunity: OpportunityListItem;
  onSelect: (opportunity: OpportunityListItem) => void;
  onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void;
}

export function OpportunityCard({ opportunity, onSelect, onMoveToStage }: OpportunityCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opportunity.id,
  });

  const label = opportunity.brandName ?? opportunity.companyName ?? opportunity.contactName;
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <Card
        className={cn(
          "flex cursor-pointer flex-col gap-1 p-3 text-sm",
          isDragging && "opacity-50",
        )}
        onClick={() => onSelect(opportunity)}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium">{label}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 md:size-8"
                onClick={(event) => event.stopPropagation()}
                aria-label="Mover para..."
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              {STAGES.map((stage) => (
                <DropdownMenuItem
                  key={stage}
                  disabled={stage === opportunity.stage}
                  onSelect={() => onMoveToStage(opportunity.id, stage)}
                >
                  {STAGE_LABELS[stage]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {opportunity.estimatedValueCents !== null ? (
          <span className="text-muted-foreground">
            {formatCurrencyBRL(opportunity.estimatedValueCents)}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">{relativeTime(opportunity.createdAt)}</span>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/pipeline/opportunity-card.test.tsx`
Expected: PASS (both cases)

- [ ] **Step 6: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add package.json pnpm-lock.yaml src/components/pipeline/opportunity-card.tsx src/components/pipeline/opportunity-card.test.tsx
git commit -m "feat: add OpportunityCard with drag support and Mover para... menu"
```

---

### Task 5: `PipelineColumn` + `PipelineBoardDesktop`

**Files:**
- Create: `src/components/pipeline/pipeline-column.tsx`
- Create: `src/components/pipeline/pipeline-board-desktop.tsx`
- Test: `src/components/pipeline/pipeline-column.test.tsx`
- Test: `src/components/pipeline/pipeline-board-desktop.test.tsx`

**Interfaces:**
- Consumes: `OpportunityCard` (Task 4), `STAGES`/`STAGE_LABELS`/`OpportunityStage` (Task 1),
  `OpportunityListItem` (Task 2).
- Produces: `PipelineColumn` from `src/components/pipeline/pipeline-column.tsx` — props
  `{stage: OpportunityStage, opportunities: OpportunityListItem[], onSelect: (opportunity:
  OpportunityListItem) => void, onMoveToStage: (opportunityId: string, stage:
  OpportunityStage) => void}`. Droppable via `@dnd-kit/core`'s `useDroppable` (drop id =
  `stage`) — this hook is safe to call even without a `DndContext` ancestor (dnd-kit's
  internal context has inert defaults), which is exactly why this same component is reused by
  both the desktop (drag-enabled) and mobile (Task 6, no drag) boards without duplicating
  column-rendering logic.
- Produces: `PipelineBoardDesktop` from `src/components/pipeline/pipeline-board-desktop.tsx`
  — props `{opportunities: OpportunityListItem[], onSelect: (opportunity: OpportunityListItem)
  => void, onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void}`. Wraps
  all 10 `PipelineColumn`s in a `DndContext`, wiring `onDragEnd` to call `onMoveToStage` when
  a card is dropped on a different column than its current stage (a drop on the SAME stage,
  or a drop outside any droppable, is a no-op).

- [ ] **Step 1: Write the failing `PipelineColumn` test**

```typescript
// src/components/pipeline/pipeline-column.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineColumn } from "./pipeline-column";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

const opportunity: OpportunityListItem = {
  id: "o1",
  organizationId: "org1",
  creatorId: "creator1",
  leadId: "lead1",
  companyId: null,
  brandId: null,
  stage: "NOVO_LEAD",
  status: "OPEN",
  estimatedValueCents: null,
  createdAt: new Date().toISOString(),
  companyName: null,
  brandName: null,
  contactName: "Maria",
};

describe("PipelineColumn", () => {
  it("renders the stage label, a count, and one card per opportunity", () => {
    render(
      <PipelineColumn
        stage="NOVO_LEAD"
        opportunities={[opportunity]}
        onSelect={() => {}}
        onMoveToStage={() => {}}
      />,
    );

    expect(screen.getByText("Novo Lead")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Maria")).toBeInTheDocument();
  });

  it("renders an empty column with a zero count and no cards", () => {
    render(
      <PipelineColumn stage="FECHADO" opportunities={[]} onSelect={() => {}} onMoveToStage={() => {}} />,
    );

    expect(screen.getByText("Fechado")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/pipeline/pipeline-column.test.tsx`
Expected: FAIL — `./pipeline-column` doesn't exist.

- [ ] **Step 3: Implement `PipelineColumn`**

```typescript
// src/components/pipeline/pipeline-column.tsx
"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { OpportunityCard } from "./opportunity-card";
import { STAGE_LABELS, type OpportunityStage } from "@/lib/opportunity-stages";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

export interface PipelineColumnProps {
  stage: OpportunityStage;
  opportunities: OpportunityListItem[];
  onSelect: (opportunity: OpportunityListItem) => void;
  onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void;
}

export function PipelineColumn({
  stage,
  opportunities,
  onSelect,
  onMoveToStage,
}: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[280px] shrink-0 flex-col gap-2 rounded-md border border-border bg-card p-2",
        isOver && "border-primary",
      )}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-sm font-medium">{STAGE_LABELS[stage]}</span>
        <span className="text-xs text-muted-foreground">{opportunities.length}</span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto">
        {opportunities.map((opportunity) => (
          <OpportunityCard
            key={opportunity.id}
            opportunity={opportunity}
            onSelect={onSelect}
            onMoveToStage={onMoveToStage}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/pipeline/pipeline-column.test.tsx`
Expected: PASS (both cases)

- [ ] **Step 5: Write the failing `PipelineBoardDesktop` test**

```typescript
// src/components/pipeline/pipeline-board-desktop.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineBoardDesktop } from "./pipeline-board-desktop";
import { STAGE_LABELS } from "@/lib/opportunity-stages";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

const opportunity: OpportunityListItem = {
  id: "o1",
  organizationId: "org1",
  creatorId: "creator1",
  leadId: "lead1",
  companyId: null,
  brandId: null,
  stage: "QUALIFICACAO",
  status: "OPEN",
  estimatedValueCents: null,
  createdAt: new Date().toISOString(),
  companyName: null,
  brandName: null,
  contactName: "Maria",
};

describe("PipelineBoardDesktop", () => {
  it("renders all 10 stage columns, placing each opportunity in its own stage's column", () => {
    render(
      <PipelineBoardDesktop opportunities={[opportunity]} onSelect={() => {}} onMoveToStage={() => {}} />,
    );

    for (const label of Object.values(STAGE_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // The one opportunity (stage QUALIFICACAO) appears once, inside that column.
    expect(screen.getAllByText("Maria")).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/components/pipeline/pipeline-board-desktop.test.tsx`
Expected: FAIL — `./pipeline-board-desktop` doesn't exist.

- [ ] **Step 7: Implement `PipelineBoardDesktop`**

```typescript
// src/components/pipeline/pipeline-board-desktop.tsx
"use client";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { PipelineColumn } from "./pipeline-column";
import { STAGES, type OpportunityStage } from "@/lib/opportunity-stages";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

export interface PipelineBoardDesktopProps {
  opportunities: OpportunityListItem[];
  onSelect: (opportunity: OpportunityListItem) => void;
  onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void;
}

export function PipelineBoardDesktop({
  opportunities,
  onSelect,
  onMoveToStage,
}: PipelineBoardDesktopProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const opportunityId = event.active.id as string;
    const newStage = event.over?.id as OpportunityStage | undefined;
    if (!newStage) return;

    const opportunity = opportunities.find((item) => item.id === opportunityId);
    if (!opportunity || opportunity.stage === newStage) return;

    onMoveToStage(opportunityId, newStage);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => (
          <PipelineColumn
            key={stage}
            stage={stage}
            opportunities={opportunities.filter((item) => item.stage === stage)}
            onSelect={onSelect}
            onMoveToStage={onMoveToStage}
          />
        ))}
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/components/pipeline/pipeline-board-desktop.test.tsx`
Expected: PASS

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/pipeline/pipeline-column.tsx src/components/pipeline/pipeline-column.test.tsx src/components/pipeline/pipeline-board-desktop.tsx src/components/pipeline/pipeline-board-desktop.test.tsx
git commit -m "feat: add PipelineColumn and PipelineBoardDesktop with drag-and-drop"
```

---

### Task 6: `PipelineBoardMobile`

**Files:**
- Create: `src/components/pipeline/pipeline-board-mobile.tsx`
- Test: `src/components/pipeline/pipeline-board-mobile.test.tsx`

**Interfaces:**
- Consumes: `PipelineColumn` (Task 5), `STAGES`/`STAGE_LABELS`/`OpportunityStage` (Task 1),
  `OpportunityListItem` (Task 2), `Button` (existing).
- Produces: `PipelineBoardMobile` from `src/components/pipeline/pipeline-board-mobile.tsx` —
  same props shape as `PipelineBoardDesktop`. Shows exactly one `PipelineColumn` at a time
  (no `DndContext` — `PipelineColumn`'s `useDroppable` is inert without one, which is fine,
  since this board never wires drag), with previous/next buttons to navigate between the 10
  stages. This IS the only way to change stage on mobile, via `PipelineColumn`'s cards'
  "Mover para..." menu (unchanged from Task 4/5 — no mobile-specific card variant needed).

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/pipeline/pipeline-board-mobile.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PipelineBoardMobile } from "./pipeline-board-mobile";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

const opportunities: OpportunityListItem[] = [
  {
    id: "o1",
    organizationId: "org1",
    creatorId: "creator1",
    leadId: "lead1",
    companyId: null,
    brandId: null,
    stage: "NOVO_LEAD",
    status: "OPEN",
    estimatedValueCents: null,
    createdAt: new Date().toISOString(),
    companyName: null,
    brandName: null,
    contactName: "Maria",
  },
  {
    id: "o2",
    organizationId: "org1",
    creatorId: "creator1",
    leadId: "lead2",
    companyId: null,
    brandId: null,
    stage: "QUALIFICACAO",
    status: "OPEN",
    estimatedValueCents: null,
    createdAt: new Date().toISOString(),
    companyName: null,
    brandName: null,
    contactName: "João",
  },
];

describe("PipelineBoardMobile", () => {
  it("shows only the first stage's column initially, and navigates forward with the next button", async () => {
    const user = userEvent.setup();
    render(
      <PipelineBoardMobile opportunities={opportunities} onSelect={() => {}} onMoveToStage={() => {}} />,
    );

    expect(screen.getByText("Novo Lead")).toBeInTheDocument();
    expect(screen.getByText("Maria")).toBeInTheDocument();
    expect(screen.queryByText("João")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage anterior" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Próximo stage" }));

    expect(screen.getByText("Qualificação")).toBeInTheDocument();
    expect(screen.getByText("João")).toBeInTheDocument();
    expect(screen.queryByText("Maria")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/pipeline/pipeline-board-mobile.test.tsx`
Expected: FAIL — `./pipeline-board-mobile` doesn't exist.

- [ ] **Step 3: Implement `PipelineBoardMobile`**

```typescript
// src/components/pipeline/pipeline-board-mobile.tsx
"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PipelineColumn } from "./pipeline-column";
import { STAGES, STAGE_LABELS, type OpportunityStage } from "@/lib/opportunity-stages";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

export interface PipelineBoardMobileProps {
  opportunities: OpportunityListItem[];
  onSelect: (opportunity: OpportunityListItem) => void;
  onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void;
}

export function PipelineBoardMobile({
  opportunities,
  onSelect,
  onMoveToStage,
}: PipelineBoardMobileProps) {
  const [index, setIndex] = React.useState(0);
  const stage = STAGES[index]!;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          disabled={index === 0}
          aria-label="Stage anterior"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm font-medium">{STAGE_LABELS[stage]}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => setIndex((current) => Math.min(STAGES.length - 1, current + 1))}
          disabled={index === STAGES.length - 1}
          aria-label="Próximo stage"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <PipelineColumn
        stage={stage}
        opportunities={opportunities.filter((item) => item.stage === stage)}
        onSelect={onSelect}
        onMoveToStage={onMoveToStage}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/pipeline/pipeline-board-mobile.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/pipeline/pipeline-board-mobile.tsx src/components/pipeline/pipeline-board-mobile.test.tsx
git commit -m "feat: add PipelineBoardMobile (single-column navigation, no drag)"
```

---

### Task 7: `OpportunitySidePanel`

**Files:**
- Create: `src/components/pipeline/opportunity-side-panel.tsx`
- Test: `src/components/pipeline/opportunity-side-panel.test.tsx`

**Interfaces:**
- Consumes: `STAGES`/`STAGE_LABELS`/`OpportunityStage` (Task 1),
  `relativeTime`/`formatCurrencyBRL` (Task 1), `OpportunityListItem` (Task 2),
  `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle`/`SheetDescription` (existing),
  `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` (existing).
- Produces: `OpportunitySidePanel` from `src/components/pipeline/opportunity-side-panel.tsx`
  — props `{opportunity: OpportunityListItem | null, open: boolean, onOpenChange: (open:
  boolean) => void, onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void}`.
  Renders using only fields already present on `opportunity` (no network call of its own —
  per the spec's explicit "no `GET /api/opportunities/:id`" constraint). The stage-change
  action here is a `Select` (not the card's `DropdownMenu` menu) — same underlying action
  ("Mover para..."), different mechanism, per the spec's explicit note that the two surfaces
  don't need to share a component.

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/pipeline/opportunity-side-panel.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpportunitySidePanel } from "./opportunity-side-panel";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

const opportunity: OpportunityListItem = {
  id: "o1",
  organizationId: "org1",
  creatorId: "creator1",
  leadId: "lead1",
  companyId: "c1",
  brandId: null,
  stage: "NOVO_LEAD",
  status: "OPEN",
  estimatedValueCents: 250000,
  createdAt: new Date().toISOString(),
  companyName: "Bella Cosméticos",
  brandName: null,
  contactName: "Maria",
};

describe("OpportunitySidePanel", () => {
  it("renders null when there's no opportunity", () => {
    const { container } = render(
      <OpportunitySidePanel opportunity={null} open={false} onOpenChange={() => {}} onMoveToStage={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the opportunity's data and changes stage via the Select", async () => {
    const user = userEvent.setup();
    const onMoveToStage = vi.fn();

    render(
      <OpportunitySidePanel
        opportunity={opportunity}
        open
        onOpenChange={() => {}}
        onMoveToStage={onMoveToStage}
      />,
    );

    expect(screen.getByText("Bella Cosméticos")).toBeInTheDocument();
    expect(screen.getByText("R$ 2.500,00")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Stage" }));
    await user.click(await screen.findByRole("option", { name: "Qualificação" }));

    expect(onMoveToStage).toHaveBeenCalledWith("o1", "QUALIFICACAO");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/pipeline/opportunity-side-panel.test.tsx`
Expected: FAIL — `./opportunity-side-panel` doesn't exist.

- [ ] **Step 3: Implement `OpportunitySidePanel`**

```typescript
// src/components/pipeline/opportunity-side-panel.tsx
"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { relativeTime, formatCurrencyBRL } from "@/lib/format";
import { STAGES, STAGE_LABELS, type OpportunityStage } from "@/lib/opportunity-stages";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

export interface OpportunitySidePanelProps {
  opportunity: OpportunityListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void;
}

export function OpportunitySidePanel({
  opportunity,
  open,
  onOpenChange,
  onMoveToStage,
}: OpportunitySidePanelProps) {
  if (!opportunity) return null;

  const label = opportunity.brandName ?? opportunity.companyName ?? opportunity.contactName;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{label}</SheetTitle>
          <SheetDescription>{relativeTime(opportunity.createdAt)}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">Contato: </span>
            {opportunity.contactName}
          </p>
          {opportunity.companyName ? (
            <p>
              <span className="text-muted-foreground">Empresa: </span>
              {opportunity.companyName}
            </p>
          ) : null}
          {opportunity.brandName ? (
            <p>
              <span className="text-muted-foreground">Marca: </span>
              {opportunity.brandName}
            </p>
          ) : null}
          {opportunity.estimatedValueCents !== null ? (
            <p>
              <span className="text-muted-foreground">Valor estimado: </span>
              {formatCurrencyBRL(opportunity.estimatedValueCents)}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="opportunity-stage">
            Stage
          </label>
          <Select
            value={opportunity.stage}
            onValueChange={(value) => onMoveToStage(opportunity.id, value as OpportunityStage)}
          >
            <SelectTrigger id="opportunity-stage" aria-label="Stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((stage) => (
                <SelectItem key={stage} value={stage}>
                  {STAGE_LABELS[stage]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/pipeline/opportunity-side-panel.test.tsx`
Expected: PASS (both cases)

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/pipeline/opportunity-side-panel.tsx src/components/pipeline/opportunity-side-panel.test.tsx
git commit -m "feat: add OpportunitySidePanel"
```

---

### Task 8: Pipeline page shell

**Files:**
- Create: `src/app/pipeline/page.tsx`

**Interfaces:**
- Consumes: `useOpportunities`/`OpportunityListItem` (Task 2),
  `useUpdateOpportunityStage` (Task 3), `PipelineBoardDesktop` (Task 5),
  `PipelineBoardMobile` (Task 6), `OpportunitySidePanel` (Task 7), `getDevOrganizationId`
  (existing, `src/lib/organization.ts`), `useCreatorContext` (existing,
  `src/components/shell/creator-context.tsx`), `EmptyState` (existing).
- Produces: the `/pipeline` route. Holds only the SELECTED OPPORTUNITY'S ID in local state
  (not a frozen copy of the object) — the displayed opportunity is derived by looking that id
  up in the live `opportunities` query result on every render, so the Side Panel's Select
  always reflects the current stage after a mutation, instead of showing a stale snapshot
  from the moment the panel was opened.

- [ ] **Step 1: Implement the page shell**

No dedicated test for `page.tsx` at this step — it's a thin composition of already-tested
pieces (`PipelineBoardDesktop`/`PipelineBoardMobile`/`OpportunitySidePanel`, each with its own
test from Tasks 5–7), following the same pattern `src/app/inbox/page.tsx` used for its own
shell (also untested directly, verified instead through its composed pieces plus manual
verification).

```typescript
// src/app/pipeline/page.tsx
"use client";

import * as React from "react";
import { KanbanSquare } from "lucide-react";
import { getDevOrganizationId } from "@/lib/organization";
import { useCreatorContext } from "@/components/shell/creator-context";
import { useOpportunities } from "@/hooks/use-opportunities";
import { useUpdateOpportunityStage } from "@/hooks/use-update-opportunity-stage";
import { EmptyState } from "@/components/ui/empty-state";
import { PipelineBoardDesktop } from "@/components/pipeline/pipeline-board-desktop";
import { PipelineBoardMobile } from "@/components/pipeline/pipeline-board-mobile";
import { OpportunitySidePanel } from "@/components/pipeline/opportunity-side-panel";
import type { OpportunityListItem } from "@/hooks/use-opportunities";
import type { OpportunityStage } from "@/lib/opportunity-stages";

export default function PipelinePage() {
  const organizationId = getDevOrganizationId();
  const { selectedCreatorId } = useCreatorContext();
  const [selectedOpportunityId, setSelectedOpportunityId] = React.useState<string | null>(null);

  const { data: opportunities, isLoading } = useOpportunities(
    organizationId,
    selectedCreatorId ?? "",
    { enabled: selectedCreatorId !== null },
  );
  const updateStage = useUpdateOpportunityStage(organizationId, selectedCreatorId ?? "");

  function handleSelect(opportunity: OpportunityListItem) {
    setSelectedOpportunityId(opportunity.id);
  }

  function handleMoveToStage(opportunityId: string, stage: OpportunityStage) {
    updateStage.mutate({ opportunityId, stage });
  }

  const selectedOpportunity =
    opportunities?.find((item) => item.id === selectedOpportunityId) ?? null;

  if (!selectedCreatorId) {
    return (
      <EmptyState
        icon={KanbanSquare}
        title="Selecione um creator"
        description="Escolha um creator no seletor do header para ver o Pipeline."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Pipeline</h1>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <>
          <div className="hidden md:block">
            <PipelineBoardDesktop
              opportunities={opportunities ?? []}
              onSelect={handleSelect}
              onMoveToStage={handleMoveToStage}
            />
          </div>
          <div className="md:hidden">
            <PipelineBoardMobile
              opportunities={opportunities ?? []}
              onSelect={handleSelect}
              onMoveToStage={handleMoveToStage}
            />
          </div>
        </>
      )}

      <OpportunitySidePanel
        opportunity={selectedOpportunity}
        open={selectedOpportunityId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedOpportunityId(null);
        }}
        onMoveToStage={handleMoveToStage}
      />
    </div>
  );
}
```

- [ ] **Step 2: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/app/pipeline/page.tsx
git commit -m "feat: assemble the Pipeline page (desktop board, mobile board, side panel)"
```

- [ ] **Step 3: Manual smoke check**

Same rationale as the Inbox plan's equivalent step — the pieces this task assembles already
have their own automated tests; mocking a full drag-and-drop interaction end-to-end in this
step would cost more than it proves.

1. Ensure a local Postgres is running with at least one organization, creator, and a few
   opportunities in different stages (reuse fixtures from earlier plans' manual checks, or
   seed via the existing API routes).
2. Set `NEXT_PUBLIC_DEV_ORGANIZATION_ID` in `.env.local`.
3. Run `pnpm dev` and open `/pipeline`.
4. Confirm: all 10 columns render in order with correct labels and counts; dragging a card to
   a different column moves it immediately and the change persists after a page reload;
   dragging to the same column is a no-op; the "Mover para..." menu on a card moves it without
   dragging; clicking a card (not the menu) opens the Side Panel showing the same data; the
   Side Panel's stage Select also moves the card and updates the board behind it; resizing to
   <768px shows one column at a time with working prev/next navigation and no drag.

## Self-Review

**Spec coverage:**
- Decisão #1 (10 colunas, largura fixa, scroll horizontal desktop, single-column mobile) —
  Tasks 5, 6.
- Decisão #2 (header da coluna: nome + contador) — Task 5.
- Decisão #3 (card: label composto, valor BRL, tempo relativo) — Task 4.
- Decisão #4 (FECHADO/PERDIDO sempre visíveis) — Task 5 renders all `STAGES` unconditionally,
  no filtering/hiding logic anywhere.
- Decisão #5 (drag-and-drop, optimistic + rollback) — Tasks 3, 4, 5.
- Decisão #6 ("Mover para..." como ação, mecanismos diferentes por local) — Task 4's
  `DropdownMenu` on the card vs. Task 7's `Select` in the Side Panel — genuinely two different
  components, not a shared one.
- Decisão #7 (sem validação de transição) — no task adds any transition-checking logic.
- Decisão #8 (Side Panel usa dados já carregados, sem GET individual) — Task 7's props take
  the full `OpportunityListItem`, no fetch inside the component; Task 8's derivation from the
  live list (not a frozen snapshot) reinforces this.
- Decisão #9 (sem ordem persistida, `createdAt desc` após refetch) — Task 3's `onSettled`
  invalidation is exactly this: the optimistic reorder is provisional, the next fetch
  re-establishes server-authoritative order.
- Decisão #10 (nenhum primitive novo, `@dnd-kit/core` é a única dependência nova) — Task 4's
  install step, confirmed absent beforehand; no other new UI library added anywhere.
- Contrato `stage` vs `status` — no task in this plan reads or writes `status` anywhere; only
  `stage` flows through the mutation.
- §1 "Fora de escopo" (Opportunity Detail completo, histórico de stage, filtros além do
  Creator Switcher, arquivamento, validação de transição, drag no mobile, paginação) — none
  introduced by any task.

**Placeholder scan:** none — every step has literal, complete code.

**Type consistency:** `OpportunityListItem` (Task 2) is imported by name — never redefined —
in Tasks 3, 4, 5, 6, 7, 8. `OpportunityStage`/`STAGES`/`STAGE_LABELS` (Task 1) are reused
identically everywhere a stage needs to be displayed or iterated. `onMoveToStage: (opportunityId:
string, stage: OpportunityStage) => void`'s exact signature is threaded unchanged from Task 4
through Tasks 5, 6, 7, and the page (Task 8), which is what finally calls
`updateStage.mutate({opportunityId, stage})` (Task 3's `UpdateStageInput` shape).
`opportunitiesQueryKey` (Task 2) is the single source of truth for the query key shape, used
identically by Task 3's mutation (both the optimistic write and the invalidation).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-pipeline-screen.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
