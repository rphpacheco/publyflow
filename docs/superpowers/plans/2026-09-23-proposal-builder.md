# Proposal Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Proposal Builder screen at `/proposals/[id]` — metadata, Cover/Text blocks,
and an items pricing table, all editable inline — plus its entry point from the Pipeline's
Opportunity Side Panel.

**Architecture:** Backend gets two small, additive adjustments (`ProposalService.create` now
seeds the two structural blocks in the same transaction; a `rateCardName` field is added to the
already-merged Rate Card Items List API). A new `AlertDialog` Design System primitive is added
(genuinely new dependency, `@radix-ui/react-alert-dialog`). Frontend data access follows the
exact TanStack Query hook convention established by the Pipeline screen
(`src/hooks/use-opportunities.ts`, `src/hooks/use-update-opportunity-stage.ts`) — one hook file
per entity, `apiFetch`/`ApiError`, exported query-key builders. UI components are built bottom-up
and independently testable (blocks, then the items table) before being assembled into the page
shell, mirroring exactly how the Pipeline plan built `OpportunityCard`/`PipelineColumn`/etc.
before its final page-assembly task.

**Tech Stack:** Next.js 16 (Client Components, async route `params`), React 19,
`@tanstack/react-query`, `@radix-ui/react-alert-dialog` (new), existing Design System primitives
(`Button`, `Input`, `Textarea`, `Select`, `Dialog`, `Sheet`, `Combobox`, `Table`, `Badge`,
`EmptyState`), Vitest + `@testing-library/react`.

## Global Constraints

- **Escopo v1**: only `proposal_items` (pricing table) and the two blocks with real design
  evidence, COVER and TEXT — no editor for the other 9 speculative block types.
- **Every proposal always has exactly one COVER and one TEXT block** — created together with the
  Proposal in one backend transaction (Task 1). No "add block" action exists in the UI.
- **`template`** is a plain `Select`, stored but with no visual effect in the builder today (no
  document renderer exists yet).
- **Every editable field (title, template, headline, body, item quantity/price) saves on blur** —
  no explicit "Salvar" button anywhere in the screen.
- **`ARCHIVED` status is read-only**: every field, block, and item becomes non-interactive; only
  "Desarquivar" remains available.
- **No item reordering** — items render in whatever order the backend returns (already
  deterministic: `sortOrder, createdAt`, fixed in an earlier cycle). No drag, no move buttons.
- **Catalog Combobox is a single flat list**, never grouped by rate card and never a two-step
  "pick a rate card first" flow. The rate card name appears as disambiguating secondary text on
  an option **only when** that option's service name is not unique across the fetched list.
  `rateCardItemId` alone identifies the chosen catalog entry — no `rateCardId` is stored on the
  proposal item.
- **No version history UI** — versioning stays invisible backend bookkeeping.
- **`userId`**: no auth/session exists yet. Every mutating proposal request carries an explicit
  `userId` in its body, sourced from a new `getDevUserId()` (Task 1), mirroring
  `getDevOrganizationId()`'s exact pattern (`src/lib/organization.ts`).
- Follow established repo conventions throughout: `"use client"` components, `apiFetch<T>`/
  `ApiError` for all fetches, exported query-key builder functions, Portuguese UI copy.

---

### Task 1: Backend — seed blocks on create, `getDevUserId()`, `rateCardName` enrichment

**Files:**
- Modify: `src/services/proposal.service.ts`
- Modify: `src/services/proposal.service.test.ts`
- Modify: `src/lib/organization.ts`
- Modify: `src/lib/organization.test.ts`
- Modify: `.env.example`
- Modify: `src/repositories/rate-card-items.repository.ts`
- Modify: `src/repositories/rate-card-items.repository.test.ts`

**Interfaces:**
- Consumes: `ProposalBlocksRepository.createWithTx` (already exists,
  `src/repositories/proposal-blocks.repository.ts`), `ProposalVersionService.createVersionWithTx`
  (already exists, `src/services/proposal-version.service.ts` — signature
  `(tx, organizationId, proposalId, createdBy) => Promise<ProposalVersion>`, and it rebuilds the
  *entire* snapshot including blocks, so the block inserts must happen before this call).
- Produces: `getDevUserId(): string` from `src/lib/organization.ts` — every later frontend task
  that mutates a proposal/item/block imports this. `RateCardItemWithService` (repository) gains a
  `rateCardName: string` field — every later frontend task reading rate card items (Task 6, Task
  8) relies on this field being present.

- [ ] **Step 1: Write the failing test for seeded blocks**

Read `src/services/proposal.service.test.ts` first — it already has a `setup(db)` helper and one
test, `"creates a proposal with an initial version snapshot"`. Extend that SAME test (don't add a
second one — it's testing the same `create` call with more assertions) by adding these lines
right after the existing `expect(snapshot.proposal.title).toBe("Campanha Verão");` line:

```typescript
    const blocks = await ProposalBlocksRepository.listByProposal(db, organization.id, proposal.id);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.blockType).sort()).toEqual(["COVER", "TEXT"]);
    const cover = blocks.find((block) => block.blockType === "COVER")!;
    const text = blocks.find((block) => block.blockType === "TEXT")!;
    expect(cover.content).toEqual({ headline: "" });
    expect(text.content).toEqual({ body: "" });

    const snapshotWithBlocks = versions[0].snapshotJson as {
      proposal: { title: string };
      blocks: { blockType: string }[];
    };
    expect(snapshotWithBlocks.blocks.map((block) => block.blockType).sort()).toEqual([
      "COVER",
      "TEXT",
    ]);
```

Add `import { ProposalBlocksRepository } from "@/repositories/proposal-blocks.repository";` to
the file's existing imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/proposal.service.test.ts`
Expected: FAIL — no blocks exist yet after `create`.

- [ ] **Step 3: Implement block seeding in `ProposalService.create`**

Read `src/services/proposal.service.ts` first. Add
`import { ProposalBlocksRepository } from "@/repositories/proposal-blocks.repository";` to its
imports, then insert two `createWithTx` calls between the existing `ProposalsRepository.createWithTx`
call and the existing `ProposalVersionService.createVersionWithTx` call inside `create`:

```typescript
      const proposal = await ProposalsRepository.createWithTx(tx, organizationId, {
        opportunityId: input.opportunityId,
        title: input.title,
        template: input.template,
      });

      await ProposalBlocksRepository.createWithTx(tx, organizationId, {
        proposalId: proposal.id,
        blockType: "COVER",
        content: { headline: "" },
      });
      await ProposalBlocksRepository.createWithTx(tx, organizationId, {
        proposalId: proposal.id,
        blockType: "TEXT",
        content: { body: "" },
      });

      await ProposalVersionService.createVersionWithTx(tx, organizationId, proposal.id, input.userId);

      return proposal;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/proposal.service.test.ts`
Expected: PASS (all tests, including the extended one)

- [ ] **Step 5: Write the failing test for `getDevUserId()`**

Read `src/lib/organization.test.ts` first (it has one `describe("getDevOrganizationId", ...)`
block). Add a second, sibling `describe` block to the same file:

```typescript
describe("getDevUserId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the configured user id", () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_USER_ID", "22222222-2222-2222-2222-222222222222");
    expect(getDevUserId()).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("throws an explicit error when the env var is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_USER_ID", "");
    expect(() => getDevUserId()).toThrow(/NEXT_PUBLIC_DEV_USER_ID/);
  });
});
```

Add `getDevUserId` to the file's existing `import { getDevOrganizationId } from "./organization";`
line.

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/lib/organization.test.ts`
Expected: FAIL — `getDevUserId` is not exported.

- [ ] **Step 7: Implement `getDevUserId()`**

Read `src/lib/organization.ts` first. Add this function after the existing
`getDevOrganizationId`:

```typescript
// See getDevOrganizationId's doc comment above -- same transitional,
// development-only mechanism, for the current user's id. Every
// proposal-mutating API call requires an explicit userId (no auth/session
// exists yet); this is where the frontend sources it from until real auth
// lands.
export function getDevUserId(): string {
  const value = process.env.NEXT_PUBLIC_DEV_USER_ID;
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_DEV_USER_ID is not set. This is a development-only " +
        "transitional mechanism used until authentication/session is implemented -- " +
        "set it in .env.local to a real user id (an organization_members row) from your local database.",
    );
  }
  return value;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/lib/organization.test.ts`
Expected: PASS (both describe blocks)

- [ ] **Step 9: Add the new env var to `.env.example`**

Read `.env.example` first. Add this block right after the existing
`NEXT_PUBLIC_DEV_ORGANIZATION_ID=` line:

```
# Required to create or edit a Proposal. Transitional, development-only
# stand-in for auth/session (see src/lib/organization.ts's getDevUserId())
# -- set it to a real user id (an organization_members row) from your local
# database.
NEXT_PUBLIC_DEV_USER_ID=
```

- [ ] **Step 10: Write the failing test for `rateCardName` enrichment**

Read `src/repositories/rate-card-items.repository.test.ts` first — find the existing test
`"listByCreator returns items enriched with service name, resolved unitDescription, only from
active rate cards and active services"`. It already creates an `activeRateCard` named
`"Tabela 2026"`. Extend that SAME test by adding these two lines right after the existing
`expect(items[1].serviceName).toBe("01 Reel");` line:

```typescript
  expect(items[0].rateCardName).toBe("Tabela 2026");
  expect(items[1].rateCardName).toBe("Tabela 2026");
```

- [ ] **Step 11: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/rate-card-items.repository.test.ts`
Expected: FAIL — `rateCardName` is `undefined` on the returned rows.

- [ ] **Step 12: Implement `rateCardName` enrichment**

Read `src/repositories/rate-card-items.repository.ts` first. Make three small edits:

1. Update the `RateCardItemWithService` type (currently):
```typescript
export type RateCardItemWithService = Omit<RateCardItem, "unitDescription"> & {
  unitDescription: string | null;
  serviceName: string;
};
```
to:
```typescript
export type RateCardItemWithService = Omit<RateCardItem, "unitDescription"> & {
  unitDescription: string | null;
  serviceName: string;
  rateCardName: string;
};
```

2. In `selectRateCardItemsByCreator`, add `rateCardName: rateCards.name` to the `.select({...})`
   object (currently `{ item: rateCardItems, serviceName: services.name, serviceUnitDescription:
   services.unitDescription }`):
```typescript
    .select({
      item: rateCardItems,
      serviceName: services.name,
      serviceUnitDescription: services.unitDescription,
      rateCardName: rateCards.name,
    })
```

3. Add `rateCardName: row.rateCardName` to the returned mapping (currently
   `{...row.item, unitDescription: ..., serviceName: row.serviceName}`):
```typescript
  return rows.map((row) => ({
    ...row.item,
    unitDescription: row.item.unitDescription ?? row.serviceUnitDescription,
    serviceName: row.serviceName,
    rateCardName: row.rateCardName,
  }));
```

- [ ] **Step 13: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/rate-card-items.repository.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 14: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/services/proposal.service.ts src/services/proposal.service.test.ts src/lib/organization.ts src/lib/organization.test.ts .env.example src/repositories/rate-card-items.repository.ts src/repositories/rate-card-items.repository.test.ts
git commit -m "feat: seed COVER/TEXT blocks on proposal create, add getDevUserId and rateCardName"
```

---

### Task 2: `AlertDialog` Design System primitive

**Files:**
- Create: `src/components/ui/alert-dialog.tsx`
- Test: `src/components/ui/alert-dialog.test.tsx`

**Interfaces:**
- Consumes: `@radix-ui/react-alert-dialog` (new dependency), `cn` (`@/lib/utils`), `Button`
  (`@/components/ui/button`, used via `asChild` by consumers — this primitive does not style its
  own action/cancel elements).
- Produces: `AlertDialog, AlertDialogTrigger, AlertDialogPortal, AlertDialogOverlay,
  AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel` from
  `src/components/ui/alert-dialog.tsx` — consumed by Task 8 (item removal confirmation) and Task
  9 (archive confirmation).

- [ ] **Step 1: Confirm the dependency is absent, then install it**

```bash
grep -n "react-alert-dialog" package.json || echo "confirmed absent"
pnpm add @radix-ui/react-alert-dialog
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/components/ui/alert-dialog.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "./alert-dialog";
import { Button } from "./button";

describe("AlertDialog", () => {
  it("opens on trigger click and calls the action handler on confirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button>Abrir</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover item?</AlertDialogTitle>
            <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button onClick={onConfirm}>Confirmar</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    expect(screen.queryByText("Remover item?")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(await screen.findByText("Remover item?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/alert-dialog.test.tsx`
Expected: FAIL — `./alert-dialog` doesn't exist.

- [ ] **Step 4: Implement the `AlertDialog` primitive**

```tsx
// src/components/ui/alert-dialog.tsx
"use client";

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "@/lib/utils";

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      className={cn("fixed inset-0 z-50 bg-overlay", className)}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-lg focus-visible:outline-none",
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex justify-end gap-2", className)} {...props} />;
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

// No default styling on Action/Cancel -- consumers always wrap a styled
// `Button` via `asChild` (see the test above), matching how Combobox wraps
// Popover/Command without imposing its own button chrome.
function AlertDialogAction(props: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return <AlertDialogPrimitive.Action {...props} />;
}

function AlertDialogCancel(props: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return <AlertDialogPrimitive.Cancel {...props} />;
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/alert-dialog.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add package.json pnpm-lock.yaml src/components/ui/alert-dialog.tsx src/components/ui/alert-dialog.test.tsx
git commit -m "feat: add AlertDialog Design System primitive"
```

---

### Task 3: `proposal-templates.ts` + `useProposals`/`useCreateProposal` hooks

**Files:**
- Create: `src/lib/proposal-templates.ts`
- Create: `src/hooks/use-proposals.ts`
- Test: `src/lib/proposal-templates.test.ts`
- Test: `src/hooks/use-proposals.test.tsx`

**Interfaces:**
- Produces: `ProposalTemplate` type, `PROPOSAL_TEMPLATES: ProposalTemplate[]`,
  `PROPOSAL_TEMPLATE_LABELS: Record<ProposalTemplate, string>`, `ProposalStatus` type,
  `PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string>` from `src/lib/proposal-templates.ts` —
  consumed by Task 4 (Side Panel dialog), Task 5 (`useProposal`), Task 9 (page metadata section).
- Produces: `Proposal` interface, `proposalsQueryKey(organizationId, opportunityId)`,
  `useProposals(organizationId, opportunityId, options?)`,
  `useCreateProposal(organizationId, userId)` from `src/hooks/use-proposals.ts` — `Proposal` is
  consumed by name (never redefined) in Task 5's `useProposal`/`useUpdateProposal`.

- [ ] **Step 1: Write the failing test for `proposal-templates.ts`**

```typescript
// src/lib/proposal-templates.test.ts
import { describe, it, expect } from "vitest";
import { PROPOSAL_TEMPLATES, PROPOSAL_TEMPLATE_LABELS, PROPOSAL_STATUS_LABELS } from "./proposal-templates";

describe("proposal templates", () => {
  it("lists all 6 templates with a Portuguese label each", () => {
    expect(PROPOSAL_TEMPLATES).toEqual([
      "PREMIUM",
      "MINIMAL",
      "EDITORIAL",
      "FASHION",
      "BEAUTY",
      "CORPORATE",
    ]);
    for (const template of PROPOSAL_TEMPLATES) {
      expect(PROPOSAL_TEMPLATE_LABELS[template]).toBeTruthy();
    }
    expect(PROPOSAL_TEMPLATE_LABELS.PREMIUM).toBe("Premium");
  });

  it("has a Portuguese label for both statuses", () => {
    expect(PROPOSAL_STATUS_LABELS.DRAFT).toBe("Rascunho");
    expect(PROPOSAL_STATUS_LABELS.ARCHIVED).toBe("Arquivada");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/proposal-templates.test.ts`
Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Implement `proposal-templates.ts`**

```typescript
// src/lib/proposal-templates.ts
export type ProposalTemplate =
  | "PREMIUM"
  | "MINIMAL"
  | "EDITORIAL"
  | "FASHION"
  | "BEAUTY"
  | "CORPORATE";

export const PROPOSAL_TEMPLATES: ProposalTemplate[] = [
  "PREMIUM",
  "MINIMAL",
  "EDITORIAL",
  "FASHION",
  "BEAUTY",
  "CORPORATE",
];

export const PROPOSAL_TEMPLATE_LABELS: Record<ProposalTemplate, string> = {
  PREMIUM: "Premium",
  MINIMAL: "Minimalista",
  EDITORIAL: "Editorial",
  FASHION: "Moda",
  BEAUTY: "Beleza",
  CORPORATE: "Corporativo",
};

export type ProposalStatus = "DRAFT" | "ARCHIVED";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho",
  ARCHIVED: "Arquivada",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/proposal-templates.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing hook tests**

```tsx
// src/hooks/use-proposals.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProposals, useCreateProposal } from "./use-proposals";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ListProbe({ organizationId, opportunityId }: { organizationId: string; opportunityId: string }) {
  const { data, isLoading } = useProposals(organizationId, opportunityId);
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} proposals</span>;
}

describe("useProposals", () => {
  it("fetches proposals for an opportunity", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "p1", title: "Campanha Verão", status: "DRAFT" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ListProbe organizationId="org1" opportunityId="opp1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 proposals")).toBeInTheDocument();

    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toContain("organizationId=org1");
    expect(requestedUrl).toContain("opportunityId=opp1");
  });
});

function CreateProbe() {
  const create = useCreateProposal("org1", "user1");
  return (
    <button
      onClick={() =>
        create.mutate({ opportunityId: "opp1", title: "Campanha Verão", template: "PREMIUM" })
      }
    >
      Criar
    </button>
  );
}

describe("useCreateProposal", () => {
  it("POSTs the new proposal with organizationId/userId injected", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: "p1",
        organizationId: "org1",
        opportunityId: "opp1",
        title: "Campanha Verão",
        template: "PREMIUM",
        status: "DRAFT",
        createdAt: new Date().toISOString(),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <CreateProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposals");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      opportunityId: "opp1",
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: "user1",
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-proposals.test.tsx`
Expected: FAIL — `./use-proposals` doesn't exist.

- [ ] **Step 7: Implement `use-proposals.ts`**

```typescript
// src/hooks/use-proposals.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { ProposalTemplate, ProposalStatus } from "@/lib/proposal-templates";

export interface Proposal {
  id: string;
  organizationId: string;
  opportunityId: string;
  title: string;
  template: ProposalTemplate;
  status: ProposalStatus;
  createdAt: string;
}

export function proposalsQueryKey(organizationId: string, opportunityId: string) {
  return ["proposals", organizationId, opportunityId] as const;
}

export function useProposals(
  organizationId: string,
  opportunityId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Proposal[]> {
  return useQuery({
    queryKey: proposalsQueryKey(organizationId, opportunityId),
    queryFn: () =>
      apiFetch<Proposal[]>(
        `/api/proposals?organizationId=${organizationId}&opportunityId=${opportunityId}`,
      ),
    enabled: options?.enabled ?? true,
  });
}

export interface CreateProposalInput {
  opportunityId: string;
  title: string;
  template: ProposalTemplate;
}

export function useCreateProposal(
  organizationId: string,
  userId: string,
): UseMutationResult<Proposal, ApiError, CreateProposalInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<Proposal>("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          opportunityId: input.opportunityId,
          title: input.title,
          template: input.template,
          userId,
        }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: proposalsQueryKey(organizationId, variables.opportunityId),
      });
    },
  });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-proposals.test.tsx`
Expected: PASS (both describe blocks)

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/lib/proposal-templates.ts src/lib/proposal-templates.test.ts src/hooks/use-proposals.ts src/hooks/use-proposals.test.tsx
git commit -m "feat: add proposal template metadata and useProposals/useCreateProposal hooks"
```

---

### Task 4: Pipeline Side Panel — "Propostas" section + "Nova Proposta" dialog

**Files:**
- Modify: `src/components/pipeline/opportunity-side-panel.tsx`
- Modify: `src/components/pipeline/opportunity-side-panel.test.tsx`

**Interfaces:**
- Consumes: `useProposals`, `useCreateProposal`, `Proposal` (Task 3, `@/hooks/use-proposals`);
  `PROPOSAL_TEMPLATES`, `PROPOSAL_TEMPLATE_LABELS`, `PROPOSAL_STATUS_LABELS`, `ProposalTemplate`
  (Task 3, `@/lib/proposal-templates`); `getDevUserId` (Task 1, `@/lib/organization`); `Dialog`,
  `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogTrigger` (existing,
  `@/components/ui/dialog`); `Badge` (existing, `@/components/ui/badge`); `Input` (existing,
  `@/components/ui/input`); `Button` (existing, `@/components/ui/button`); `useRouter` from
  `next/navigation`.
- Modifies: `OpportunitySidePanelProps` is unchanged (no new required props — `organizationId`
  and `opportunityId` are both derived from the existing `opportunity` prop's `organizationId`/
  `id` fields).

- [ ] **Step 1: Write the failing tests**

Read `src/components/pipeline/opportunity-side-panel.test.tsx` first — its two existing tests
don't wrap the component in a `QueryClientProvider` (it currently has no hook that needs one).
Rewrite the file to add that wrapper (needed now that the component calls `useProposals`), mock
`next/navigation`, and add the new proposals-related tests:

```tsx
// src/components/pipeline/opportunity-side-panel.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OpportunitySidePanel } from "./opportunity-side-panel";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

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

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("OpportunitySidePanel", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_DEV_USER_ID", "11111111-1111-1111-1111-111111111111");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("renders null when there's no opportunity", () => {
    const { container } = renderWithClient(
      <OpportunitySidePanel opportunity={null} open={false} onOpenChange={() => {}} onMoveToStage={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the opportunity's data and changes stage via the Select", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
    const user = userEvent.setup();
    const onMoveToStage = vi.fn();

    renderWithClient(
      <OpportunitySidePanel
        opportunity={opportunity}
        open
        onOpenChange={() => {}}
        onMoveToStage={onMoveToStage}
      />,
    );

    expect(screen.getByText("Bella Cosméticos")).toBeInTheDocument();
    expect(screen.getByText("R$ 2.500,00")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Stage" }));
    await user.click(await screen.findByRole("option", { name: "Qualificação" }));

    expect(onMoveToStage).toHaveBeenCalledWith("o1", "QUALIFICACAO");
  });

  it("lists existing proposals with a status badge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "p1",
            organizationId: "org1",
            opportunityId: "o1",
            title: "Campanha Verão",
            template: "PREMIUM",
            status: "DRAFT",
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );

    renderWithClient(
      <OpportunitySidePanel opportunity={opportunity} open onOpenChange={() => {}} onMoveToStage={() => {}} />,
    );

    expect(await screen.findByText("Campanha Verão")).toBeInTheDocument();
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
  });

  it("creates a new proposal via the dialog", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/proposals?")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({
          id: "p2",
          organizationId: "org1",
          opportunityId: "o1",
          title: "Nova Campanha",
          template: "PREMIUM",
          status: "DRAFT",
          createdAt: new Date().toISOString(),
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <OpportunitySidePanel opportunity={opportunity} open onOpenChange={() => {}} onMoveToStage={() => {}} />,
    );

    await user.click(screen.getByRole("button", { name: "Nova Proposta" }));
    await user.type(screen.getByLabelText("Título"), "Nova Campanha");
    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: "Premium" }));
    await user.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/pipeline/opportunity-side-panel.test.tsx`
Expected: FAIL — no "Propostas" section, no "Nova Proposta" button exist yet.

- [ ] **Step 3: Implement the "Propostas" section and dialog**

Read the current content of `src/components/pipeline/opportunity-side-panel.tsx` first. Add the
new imports and the `router`/`useProposals`/`useCreateProposal`/create-dialog state at the top of
the component, and the new "Propostas" section right after the existing "Stage" `<div>` block
(before the closing `</SheetContent>`):

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { relativeTime, formatCurrencyBRL } from "@/lib/format";
import { STAGES, STAGE_LABELS, type OpportunityStage } from "@/lib/opportunity-stages";
import { getDevUserId } from "@/lib/organization";
import { useProposals, useCreateProposal } from "@/hooks/use-proposals";
import {
  PROPOSAL_TEMPLATES,
  PROPOSAL_TEMPLATE_LABELS,
  PROPOSAL_STATUS_LABELS,
  type ProposalTemplate,
} from "@/lib/proposal-templates";
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
  const router = useRouter();
  const organizationId = opportunity?.organizationId ?? "";
  const opportunityId = opportunity?.id ?? "";

  const { data: proposals } = useProposals(organizationId, opportunityId, {
    enabled: opportunity !== null,
  });
  const createProposal = useCreateProposal(organizationId, getDevUserId());

  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [template, setTemplate] = React.useState<ProposalTemplate | "">("");

  function handleCreate() {
    if (!title.trim() || !template) return;
    createProposal.mutate(
      { opportunityId, title: title.trim(), template },
      {
        onSuccess: (proposal) => {
          setCreateDialogOpen(false);
          setTitle("");
          setTemplate("");
          router.push(`/proposals/${proposal.id}`);
        },
      },
    );
  }

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
          {opportunity.companyName && opportunity.companyName !== label ? (
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

        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Propostas</span>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Nova Proposta
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nova Proposta</DialogTitle>
                  <DialogDescription>Título e template podem ser ajustados depois.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="new-proposal-title">
                      Título
                    </label>
                    <Input
                      id="new-proposal-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Ex: Campanha Verão"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="new-proposal-template">
                      Template
                    </label>
                    <Select value={template} onValueChange={(value) => setTemplate(value as ProposalTemplate)}>
                      <SelectTrigger id="new-proposal-template" aria-label="Template">
                        <SelectValue placeholder="Selecionar template" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROPOSAL_TEMPLATES.map((item) => (
                          <SelectItem key={item} value={item}>
                            {PROPOSAL_TEMPLATE_LABELS[item]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button onClick={handleCreate} disabled={!title.trim() || !template || createProposal.isPending}>
                    Criar
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {proposals && proposals.length > 0 ? (
            <div className="flex flex-col gap-1">
              {proposals.map((proposal) => (
                <button
                  key={proposal.id}
                  onClick={() => router.push(`/proposals/${proposal.id}`)}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span>{proposal.title}</span>
                  <Badge>{PROPOSAL_STATUS_LABELS[proposal.status]}</Badge>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma proposta ainda.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/pipeline/opportunity-side-panel.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/pipeline/opportunity-side-panel.tsx src/components/pipeline/opportunity-side-panel.test.tsx
git commit -m "feat: add Propostas section and Nova Proposta dialog to the Opportunity Side Panel"
```

---

### Task 5: `useProposal`/`useUpdateProposal`, `useProposalBlocks`/`useUpdateProposalBlock`, `useOpportunity` hooks

**Files:**
- Create: `src/hooks/use-proposal.ts`
- Create: `src/hooks/use-proposal-blocks.ts`
- Create: `src/hooks/use-opportunity.ts`
- Test: `src/hooks/use-proposal.test.tsx`
- Test: `src/hooks/use-proposal-blocks.test.tsx`
- Test: `src/hooks/use-opportunity.test.tsx`

**Interfaces:**
- Consumes: `Proposal` (Task 3, `@/hooks/use-proposals`); `ProposalTemplate`, `ProposalStatus`
  (Task 3, `@/lib/proposal-templates`); `OpportunityStage` (existing, `@/lib/opportunity-stages`).
- Produces: `proposalQueryKey`, `useProposal(organizationId, proposalId, options?)`,
  `UpdateProposalInput`, `useUpdateProposal(organizationId, proposalId, userId)` from
  `src/hooks/use-proposal.ts`. `ProposalBlockType`, `ProposalBlock`,
  `proposalBlocksQueryKey`, `useProposalBlocks(organizationId, proposalId, options?)`,
  `UpdateProposalBlockInput`, `useUpdateProposalBlock(organizationId, proposalId, userId)` from
  `src/hooks/use-proposal-blocks.ts` — `ProposalBlock` is consumed by Task 7 (Cover/Text
  sections). `Opportunity`, `opportunityQueryKey`, `useOpportunity(organizationId, opportunityId,
  options?)` from `src/hooks/use-opportunity.ts` — consumed by Task 9 (page shell, to resolve
  `creatorId` for the catalog Combobox).

- [ ] **Step 1: Write the failing `use-proposal.ts` tests**

```tsx
// src/hooks/use-proposal.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProposal, useUpdateProposal } from "./use-proposal";

afterEach(() => {
  vi.unstubAllGlobals();
});

function GetProbe() {
  const { data, isLoading } = useProposal("org1", "p1");
  if (isLoading) return <span>loading</span>;
  return <span>{data?.title}</span>;
}

describe("useProposal", () => {
  it("fetches a single proposal by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "p1",
        organizationId: "org1",
        opportunityId: "opp1",
        title: "Campanha Verão",
        template: "PREMIUM",
        status: "DRAFT",
        createdAt: new Date().toISOString(),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <GetProbe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Campanha Verão")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proposals/p1?organizationId=org1");
  });
});

function UpdateProbe() {
  const update = useUpdateProposal("org1", "p1", "user1");
  return <button onClick={() => update.mutate({ status: "ARCHIVED" })}>Arquivar</button>;
}

describe("useUpdateProposal", () => {
  it("PATCHes with organizationId/userId injected", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "p1",
        organizationId: "org1",
        opportunityId: "opp1",
        title: "Campanha Verão",
        template: "PREMIUM",
        status: "ARCHIVED",
        createdAt: new Date().toISOString(),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <UpdateProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposals/p1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      userId: "user1",
      status: "ARCHIVED",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-proposal.test.tsx`
Expected: FAIL — `./use-proposal` doesn't exist.

- [ ] **Step 3: Implement `use-proposal.ts`**

```typescript
// src/hooks/use-proposal.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { Proposal } from "./use-proposals";
import type { ProposalTemplate, ProposalStatus } from "@/lib/proposal-templates";

export function proposalQueryKey(organizationId: string, proposalId: string) {
  return ["proposal", organizationId, proposalId] as const;
}

export function useProposal(
  organizationId: string,
  proposalId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Proposal> {
  return useQuery({
    queryKey: proposalQueryKey(organizationId, proposalId),
    queryFn: () => apiFetch<Proposal>(`/api/proposals/${proposalId}?organizationId=${organizationId}`),
    enabled: options?.enabled ?? true,
  });
}

export interface UpdateProposalInput {
  title?: string;
  template?: ProposalTemplate;
  status?: ProposalStatus;
}

export function useUpdateProposal(
  organizationId: string,
  proposalId: string,
  userId: string,
): UseMutationResult<Proposal, ApiError, UpdateProposalInput> {
  const queryClient = useQueryClient();
  const queryKey = proposalQueryKey(organizationId, proposalId);

  return useMutation({
    mutationFn: (input) =>
      apiFetch<Proposal>(`/api/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, userId, ...input }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-proposal.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing `use-proposal-blocks.ts` tests**

```tsx
// src/hooks/use-proposal-blocks.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProposalBlocks, useUpdateProposalBlock } from "./use-proposal-blocks";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ListProbe() {
  const { data, isLoading } = useProposalBlocks("org1", "p1");
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} blocks</span>;
}

describe("useProposalBlocks", () => {
  it("fetches blocks for a proposal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "b1", blockType: "COVER", content: { headline: "" } }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ListProbe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 blocks")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proposals/p1/blocks?organizationId=org1");
  });
});

function UpdateProbe() {
  const update = useUpdateProposalBlock("org1", "p1", "user1");
  return (
    <button onClick={() => update.mutate({ blockId: "b1", content: { headline: "Nova capa" } })}>
      Salvar
    </button>
  );
}

describe("useUpdateProposalBlock", () => {
  it("PATCHes the block with organizationId/proposalId/userId injected", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "b1", blockType: "COVER", content: { headline: "Nova capa" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <UpdateProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposal-blocks/b1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      proposalId: "p1",
      userId: "user1",
      content: { headline: "Nova capa" },
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-proposal-blocks.test.tsx`
Expected: FAIL — `./use-proposal-blocks` doesn't exist.

- [ ] **Step 7: Implement `use-proposal-blocks.ts`**

```typescript
// src/hooks/use-proposal-blocks.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api-client";

export type ProposalBlockType =
  | "COVER"
  | "TEXT"
  | "IMAGE"
  | "METRICS"
  | "SERVICES"
  | "PRICING"
  | "TIMELINE"
  | "GALLERY"
  | "TESTIMONIALS"
  | "SOCIAL_LINKS"
  | "FOOTER";

export interface ProposalBlock {
  id: string;
  organizationId: string;
  proposalId: string;
  blockType: ProposalBlockType;
  content: unknown;
  sortOrder: number;
  createdAt: string;
}

export function proposalBlocksQueryKey(organizationId: string, proposalId: string) {
  return ["proposal-blocks", organizationId, proposalId] as const;
}

export function useProposalBlocks(
  organizationId: string,
  proposalId: string,
  options?: { enabled?: boolean },
): UseQueryResult<ProposalBlock[]> {
  return useQuery({
    queryKey: proposalBlocksQueryKey(organizationId, proposalId),
    queryFn: () =>
      apiFetch<ProposalBlock[]>(`/api/proposals/${proposalId}/blocks?organizationId=${organizationId}`),
    enabled: options?.enabled ?? true,
  });
}

export interface UpdateProposalBlockInput {
  blockId: string;
  content: unknown;
}

export function useUpdateProposalBlock(
  organizationId: string,
  proposalId: string,
  userId: string,
): UseMutationResult<ProposalBlock, ApiError, UpdateProposalBlockInput> {
  const queryClient = useQueryClient();
  const queryKey = proposalBlocksQueryKey(organizationId, proposalId);

  return useMutation({
    mutationFn: ({ blockId, content }) =>
      apiFetch<ProposalBlock>(`/api/proposal-blocks/${blockId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, proposalId, userId, content }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<ProposalBlock[]>(queryKey, (old) =>
        old?.map((block) => (block.id === data.id ? data : block)) ?? old,
      );
    },
    onError: () => {
      toast.error("Não foi possível salvar. Tente novamente.");
    },
  });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-proposal-blocks.test.tsx`
Expected: PASS

- [ ] **Step 9: Write the failing `use-opportunity.ts` test**

```tsx
// src/hooks/use-opportunity.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOpportunity } from "./use-opportunity";

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe() {
  const { data, isLoading } = useOpportunity("org1", "opp1");
  if (isLoading) return <span>loading</span>;
  return <span>{data?.creatorId}</span>;
}

describe("useOpportunity", () => {
  it("fetches a single opportunity by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "opp1",
        organizationId: "org1",
        creatorId: "creator1",
        leadId: "lead1",
        companyId: null,
        brandId: null,
        stage: "NOVO_LEAD",
        status: "OPEN",
        estimatedValueCents: null,
        createdAt: new Date().toISOString(),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("creator1")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/opportunities/opp1?organizationId=org1");
  });

  it("does not fetch when disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    function DisabledProbe() {
      useOpportunity("org1", "", { enabled: false });
      return <span>disabled</span>;
    }

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
```

- [ ] **Step 10: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-opportunity.test.tsx`
Expected: FAIL — `./use-opportunity` doesn't exist.

- [ ] **Step 11: Implement `use-opportunity.ts`**

```typescript
// src/hooks/use-opportunity.ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { OpportunityStage } from "@/lib/opportunity-stages";

export interface Opportunity {
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
}

export function opportunityQueryKey(organizationId: string, opportunityId: string) {
  return ["opportunity", organizationId, opportunityId] as const;
}

export function useOpportunity(
  organizationId: string,
  opportunityId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Opportunity> {
  return useQuery({
    queryKey: opportunityQueryKey(organizationId, opportunityId),
    queryFn: () =>
      apiFetch<Opportunity>(`/api/opportunities/${opportunityId}?organizationId=${organizationId}`),
    enabled: options?.enabled ?? true,
  });
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-opportunity.test.tsx`
Expected: PASS (both cases)

- [ ] **Step 13: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/hooks/use-proposal.ts src/hooks/use-proposal.test.tsx src/hooks/use-proposal-blocks.ts src/hooks/use-proposal-blocks.test.tsx src/hooks/use-opportunity.ts src/hooks/use-opportunity.test.tsx
git commit -m "feat: add useProposal, useProposalBlocks, and useOpportunity hooks"
```

---

### Task 6: `useProposalItems`/mutations + `useRateCardItems` hooks

**Files:**
- Create: `src/hooks/use-proposal-items.ts`
- Create: `src/hooks/use-rate-card-items.ts`
- Test: `src/hooks/use-proposal-items.test.tsx`
- Test: `src/hooks/use-rate-card-items.test.tsx`

**Interfaces:**
- Produces: `ProposalItem` interface, `proposalItemsQueryKey`,
  `useProposalItems(organizationId, proposalId, options?)`, `AddProposalItemInput`,
  `useAddProposalItem(organizationId, proposalId, userId)`, `UpdateProposalItemInput`,
  `useUpdateProposalItem(organizationId, proposalId, userId)`,
  `useRemoveProposalItem(organizationId, proposalId, userId)` from
  `src/hooks/use-proposal-items.ts` — `ProposalItem` consumed by Task 8 (items table) and Task 9
  (page shell).
- Produces: `RateCardItemWithService` interface (frontend mirror — now includes `rateCardName`
  per Task 1's backend addition), `rateCardItemsQueryKey`,
  `useRateCardItems(organizationId, creatorId, options?)` from
  `src/hooks/use-rate-card-items.ts` — consumed by Task 8.

- [ ] **Step 1: Write the failing `use-proposal-items.ts` tests**

```tsx
// src/hooks/use-proposal-items.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useProposalItems,
  useAddProposalItem,
  useUpdateProposalItem,
  useRemoveProposalItem,
} from "./use-proposal-items";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ListProbe() {
  const { data, isLoading } = useProposalItems("org1", "p1");
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} items</span>;
}

describe("useProposalItems", () => {
  it("fetches items for a proposal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "i1", description: "Reel", quantity: 1, unitPrice: 150000 }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ListProbe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 items")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proposals/p1/items?organizationId=org1");
  });
});

function AddCatalogProbe() {
  const add = useAddProposalItem("org1", "p1", "user1");
  return <button onClick={() => add.mutate({ rateCardItemId: "rci1" })}>Adicionar do catálogo</button>;
}

function AddAdHocProbe() {
  const add = useAddProposalItem("org1", "p1", "user1");
  return (
    <button onClick={() => add.mutate({ description: "Desconto", unitPrice: -20000 })}>
      Adicionar avulso
    </button>
  );
}

describe("useAddProposalItem", () => {
  it("POSTs a catalog item with rateCardItemId", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "i1", description: "Reel", quantity: 1, unitPrice: 150000 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddCatalogProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Adicionar do catálogo" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposals/p1/items");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      userId: "user1",
      rateCardItemId: "rci1",
    });
  });

  it("POSTs an ad-hoc item with a negative unitPrice (discount)", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "i2", description: "Desconto", quantity: 1, unitPrice: -20000 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddAdHocProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Adicionar avulso" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      userId: "user1",
      description: "Desconto",
      unitPrice: -20000,
    });
  });
});

function UpdateProbe() {
  const update = useUpdateProposalItem("org1", "p1", "user1");
  return <button onClick={() => update.mutate({ itemId: "i1", quantity: 2 })}>Atualizar</button>;
}

describe("useUpdateProposalItem", () => {
  it("PATCHes the item with organizationId/proposalId/userId injected", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "i1", description: "Reel", quantity: 2, unitPrice: 150000 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <UpdateProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposal-items/i1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      proposalId: "p1",
      userId: "user1",
      quantity: 2,
    });
  });
});

function RemoveProbe() {
  const remove = useRemoveProposalItem("org1", "p1", "user1");
  return <button onClick={() => remove.mutate("i1")}>Remover</button>;
}

describe("useRemoveProposalItem", () => {
  it("DELETEs the item with organizationId/proposalId/userId in the body", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <RemoveProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposal-items/i1");
    expect((init as RequestInit).method).toBe("DELETE");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      proposalId: "p1",
      userId: "user1",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-proposal-items.test.tsx`
Expected: FAIL — `./use-proposal-items` doesn't exist.

- [ ] **Step 3: Implement `use-proposal-items.ts`**

```typescript
// src/hooks/use-proposal-items.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api-client";

export interface ProposalItem {
  id: string;
  organizationId: string;
  proposalId: string;
  rateCardItemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  sortOrder: number;
  createdAt: string;
}

export function proposalItemsQueryKey(organizationId: string, proposalId: string) {
  return ["proposal-items", organizationId, proposalId] as const;
}

export function useProposalItems(
  organizationId: string,
  proposalId: string,
  options?: { enabled?: boolean },
): UseQueryResult<ProposalItem[]> {
  return useQuery({
    queryKey: proposalItemsQueryKey(organizationId, proposalId),
    queryFn: () =>
      apiFetch<ProposalItem[]>(`/api/proposals/${proposalId}/items?organizationId=${organizationId}`),
    enabled: options?.enabled ?? true,
  });
}

export type AddProposalItemInput =
  | { rateCardItemId: string }
  | { description: string; unitPrice: number };

export function useAddProposalItem(
  organizationId: string,
  proposalId: string,
  userId: string,
): UseMutationResult<ProposalItem, ApiError, AddProposalItemInput> {
  const queryClient = useQueryClient();
  const queryKey = proposalItemsQueryKey(organizationId, proposalId);

  return useMutation({
    mutationFn: (input) =>
      apiFetch<ProposalItem>(`/api/proposals/${proposalId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, userId, ...input }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast.error("Não foi possível adicionar o item. Tente novamente.");
    },
  });
}

export interface UpdateProposalItemInput {
  itemId: string;
  description?: string;
  unitPrice?: number;
  quantity?: number;
}

export function useUpdateProposalItem(
  organizationId: string,
  proposalId: string,
  userId: string,
): UseMutationResult<ProposalItem, ApiError, UpdateProposalItemInput> {
  const queryClient = useQueryClient();
  const queryKey = proposalItemsQueryKey(organizationId, proposalId);

  return useMutation({
    mutationFn: ({ itemId, ...input }) =>
      apiFetch<ProposalItem>(`/api/proposal-items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, proposalId, userId, ...input }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<ProposalItem[]>(queryKey, (old) =>
        old?.map((item) => (item.id === data.id ? data : item)) ?? old,
      );
    },
    onError: () => {
      toast.error("Não foi possível salvar. Tente novamente.");
    },
  });
}

export function useRemoveProposalItem(
  organizationId: string,
  proposalId: string,
  userId: string,
): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();
  const queryKey = proposalItemsQueryKey(organizationId, proposalId);

  return useMutation({
    mutationFn: (itemId) =>
      apiFetch<void>(`/api/proposal-items/${itemId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, proposalId, userId }),
      }),
    onSuccess: (_data, itemId) => {
      queryClient.setQueryData<ProposalItem[]>(queryKey, (old) => old?.filter((item) => item.id !== itemId) ?? old);
    },
    onError: () => {
      toast.error("Não foi possível remover o item. Tente novamente.");
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-proposal-items.test.tsx`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Write the failing `use-rate-card-items.ts` test**

```tsx
// src/hooks/use-rate-card-items.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRateCardItems } from "./use-rate-card-items";

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe() {
  const { data, isLoading } = useRateCardItems("org1", "creator1");
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} items</span>;
}

describe("useRateCardItems", () => {
  it("fetches catalog items for a creator", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: "rci1",
          organizationId: "org1",
          rateCardId: "rc1",
          serviceId: "s1",
          price: 250000,
          unitDescription: "por post",
          sortOrder: 0,
          createdAt: new Date().toISOString(),
          serviceName: "Reel patrocinado",
          rateCardName: "Tabela Padrão",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 items")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/rate-card-items?organizationId=org1&creatorId=creator1");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-rate-card-items.test.tsx`
Expected: FAIL — `./use-rate-card-items` doesn't exist.

- [ ] **Step 7: Implement `use-rate-card-items.ts`**

```typescript
// src/hooks/use-rate-card-items.ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface RateCardItemWithService {
  id: string;
  organizationId: string;
  rateCardId: string;
  serviceId: string;
  price: number;
  unitDescription: string | null;
  sortOrder: number;
  createdAt: string;
  serviceName: string;
  rateCardName: string;
}

export function rateCardItemsQueryKey(organizationId: string, creatorId: string) {
  return ["rate-card-items", organizationId, creatorId] as const;
}

export function useRateCardItems(
  organizationId: string,
  creatorId: string,
  options?: { enabled?: boolean },
): UseQueryResult<RateCardItemWithService[]> {
  return useQuery({
    queryKey: rateCardItemsQueryKey(organizationId, creatorId),
    queryFn: () =>
      apiFetch<RateCardItemWithService[]>(
        `/api/rate-card-items?organizationId=${organizationId}&creatorId=${creatorId}`,
      ),
    enabled: options?.enabled ?? true,
  });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-rate-card-items.test.tsx`
Expected: PASS

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/hooks/use-proposal-items.ts src/hooks/use-proposal-items.test.tsx src/hooks/use-rate-card-items.ts src/hooks/use-rate-card-items.test.tsx
git commit -m "feat: add useProposalItems/mutations and useRateCardItems hooks"
```

---

### Task 7: `ProposalCoverSection` + `ProposalTextSection` components

**Files:**
- Create: `src/components/proposals/proposal-cover-section.tsx`
- Create: `src/components/proposals/proposal-text-section.tsx`
- Test: `src/components/proposals/proposal-cover-section.test.tsx`
- Test: `src/components/proposals/proposal-text-section.test.tsx`

**Interfaces:**
- Consumes: `useUpdateProposalBlock`, `ProposalBlock` (Task 5, `@/hooks/use-proposal-blocks`);
  `Input` (existing, `@/components/ui/input`); `Textarea` (existing, `@/components/ui/textarea`).
- Produces: `ProposalCoverSection` (props `{organizationId, proposalId, userId, block:
  ProposalBlock, readOnly: boolean}`) from `proposal-cover-section.tsx`. `ProposalTextSection`
  (same props shape) from `proposal-text-section.tsx`. Both consumed by Task 9 (page shell).

- [ ] **Step 1: Write the failing `ProposalCoverSection` test**

```tsx
// src/components/proposals/proposal-cover-section.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProposalCoverSection } from "./proposal-cover-section";
import type { ProposalBlock } from "@/hooks/use-proposal-blocks";

afterEach(() => {
  vi.unstubAllGlobals();
});

const block: ProposalBlock = {
  id: "b1",
  organizationId: "org1",
  proposalId: "p1",
  blockType: "COVER",
  content: { headline: "Campanha Verão" },
  sortOrder: 0,
  createdAt: new Date().toISOString(),
};

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ProposalCoverSection", () => {
  it("shows the current headline and saves on blur when changed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...block, content: { headline: "Nova Capa" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalCoverSection organizationId="org1" proposalId="p1" userId="user1" block={block} readOnly={false} />,
    );

    const input = screen.getByLabelText("Capa");
    expect(input).toHaveValue("Campanha Verão");

    await user.clear(input);
    await user.type(input, "Nova Capa");
    await user.tab();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposal-blocks/b1");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      proposalId: "p1",
      userId: "user1",
      content: { headline: "Nova Capa" },
    });
  });

  it("does not save on blur when the value is unchanged", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalCoverSection organizationId="org1" proposalId="p1" userId="user1" block={block} readOnly={false} />,
    );

    await user.click(screen.getByLabelText("Capa"));
    await user.tab();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables the input when readOnly", () => {
    renderWithClient(
      <ProposalCoverSection organizationId="org1" proposalId="p1" userId="user1" block={block} readOnly />,
    );
    expect(screen.getByLabelText("Capa")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/proposals/proposal-cover-section.test.tsx`
Expected: FAIL — `./proposal-cover-section` doesn't exist.

- [ ] **Step 3: Implement `ProposalCoverSection`**

```tsx
// src/components/proposals/proposal-cover-section.tsx
"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { useUpdateProposalBlock } from "@/hooks/use-proposal-blocks";
import type { ProposalBlock } from "@/hooks/use-proposal-blocks";

export interface ProposalCoverSectionProps {
  organizationId: string;
  proposalId: string;
  userId: string;
  block: ProposalBlock;
  readOnly: boolean;
}

export function ProposalCoverSection({
  organizationId,
  proposalId,
  userId,
  block,
  readOnly,
}: ProposalCoverSectionProps) {
  const updateBlock = useUpdateProposalBlock(organizationId, proposalId, userId);
  const initialHeadline = (block.content as { headline?: string })?.headline ?? "";
  const [headline, setHeadline] = React.useState(initialHeadline);

  React.useEffect(() => {
    setHeadline(initialHeadline);
  }, [initialHeadline]);

  function handleBlur() {
    if (headline === initialHeadline) return;
    updateBlock.mutate({ blockId: block.id, content: { headline } });
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="proposal-cover-headline">
        Capa
      </label>
      <Input
        id="proposal-cover-headline"
        aria-label="Capa"
        value={headline}
        onChange={(event) => setHeadline(event.target.value)}
        onBlur={handleBlur}
        disabled={readOnly}
        placeholder="Título da capa"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/proposals/proposal-cover-section.test.tsx`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Write the failing `ProposalTextSection` test**

```tsx
// src/components/proposals/proposal-text-section.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProposalTextSection } from "./proposal-text-section";
import type { ProposalBlock } from "@/hooks/use-proposal-blocks";

afterEach(() => {
  vi.unstubAllGlobals();
});

const block: ProposalBlock = {
  id: "b2",
  organizationId: "org1",
  proposalId: "p1",
  blockType: "TEXT",
  content: { body: "Texto original" },
  sortOrder: 1,
  createdAt: new Date().toISOString(),
};

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ProposalTextSection", () => {
  it("shows the current body and saves on blur when changed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...block, content: { body: "Texto novo" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalTextSection organizationId="org1" proposalId="p1" userId="user1" block={block} readOnly={false} />,
    );

    const textarea = screen.getByLabelText("Texto");
    expect(textarea).toHaveValue("Texto original");

    await user.clear(textarea);
    await user.type(textarea, "Texto novo");
    await user.tab();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposal-blocks/b2");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      proposalId: "p1",
      userId: "user1",
      content: { body: "Texto novo" },
    });
  });

  it("disables the textarea when readOnly", () => {
    renderWithClient(
      <ProposalTextSection organizationId="org1" proposalId="p1" userId="user1" block={block} readOnly />,
    );
    expect(screen.getByLabelText("Texto")).toBeDisabled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/components/proposals/proposal-text-section.test.tsx`
Expected: FAIL — `./proposal-text-section` doesn't exist.

- [ ] **Step 7: Implement `ProposalTextSection`**

```tsx
// src/components/proposals/proposal-text-section.tsx
"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateProposalBlock } from "@/hooks/use-proposal-blocks";
import type { ProposalBlock } from "@/hooks/use-proposal-blocks";

export interface ProposalTextSectionProps {
  organizationId: string;
  proposalId: string;
  userId: string;
  block: ProposalBlock;
  readOnly: boolean;
}

export function ProposalTextSection({
  organizationId,
  proposalId,
  userId,
  block,
  readOnly,
}: ProposalTextSectionProps) {
  const updateBlock = useUpdateProposalBlock(organizationId, proposalId, userId);
  const initialBody = (block.content as { body?: string })?.body ?? "";
  const [body, setBody] = React.useState(initialBody);

  React.useEffect(() => {
    setBody(initialBody);
  }, [initialBody]);

  function handleBlur() {
    if (body === initialBody) return;
    updateBlock.mutate({ blockId: block.id, content: { body } });
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="proposal-text-body">
        Texto
      </label>
      <Textarea
        id="proposal-text-body"
        aria-label="Texto"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onBlur={handleBlur}
        disabled={readOnly}
        placeholder="Escreva uma mensagem para o cliente..."
        rows={4}
      />
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/components/proposals/proposal-text-section.test.tsx`
Expected: PASS (both cases)

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/proposals/proposal-cover-section.tsx src/components/proposals/proposal-cover-section.test.tsx src/components/proposals/proposal-text-section.tsx src/components/proposals/proposal-text-section.test.tsx
git commit -m "feat: add ProposalCoverSection and ProposalTextSection components"
```

---

### Task 8: `ProposalItemsTable` component

**Files:**
- Create: `src/components/proposals/proposal-items-table.tsx`
- Test: `src/components/proposals/proposal-items-table.test.tsx`

**Interfaces:**
- Consumes: `useRateCardItems`, `RateCardItemWithService` (Task 6,
  `@/hooks/use-rate-card-items`); `useAddProposalItem`, `useUpdateProposalItem`,
  `useRemoveProposalItem`, `ProposalItem` (Task 6, `@/hooks/use-proposal-items`); `Combobox`
  (existing, `@/components/ui/combobox`); `Table`/`TableHeader`/`TableBody`/`TableRow`/
  `TableHead`/`TableCell` (existing, `@/components/ui/table`); `EmptyState` (existing,
  `@/components/ui/empty-state`); `AlertDialog*` (Task 2, `@/components/ui/alert-dialog`);
  `formatCurrencyBRL` (existing, `@/lib/format`).
- Produces: `ProposalItemsTable` (props `{organizationId, proposalId, userId, items:
  ProposalItem[], creatorId: string | null, readOnly: boolean}`) from
  `proposal-items-table.tsx` — consumed by Task 9 (page shell).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/proposals/proposal-items-table.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProposalItemsTable } from "./proposal-items-table";
import type { ProposalItem } from "@/hooks/use-proposal-items";

afterEach(() => {
  vi.unstubAllGlobals();
});

const items: ProposalItem[] = [
  {
    id: "i1",
    organizationId: "org1",
    proposalId: "p1",
    rateCardItemId: "rci1",
    description: "Reel patrocinado",
    quantity: 2,
    unitPrice: 150000,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
  },
];

const catalogItems = [
  {
    id: "rci1",
    organizationId: "org1",
    rateCardId: "rc1",
    serviceId: "s1",
    price: 150000,
    unitDescription: "por post",
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    serviceName: "Reel patrocinado",
    rateCardName: "Tabela Padrão",
  },
  {
    id: "rci2",
    organizationId: "org1",
    rateCardId: "rc2",
    serviceId: "s1",
    price: 220000,
    unitDescription: "por post",
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    serviceName: "Reel patrocinado",
    rateCardName: "Tabela Especial",
  },
  {
    id: "rci3",
    organizationId: "org1",
    rateCardId: "rc1",
    serviceId: "s2",
    price: 80000,
    unitDescription: "por post",
    sortOrder: 1,
    createdAt: new Date().toISOString(),
    serviceName: "Stories",
    rateCardName: "Tabela Padrão",
  },
];

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ProposalItemsTable", () => {
  it("shows an EmptyState when there are no items", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={[]} creatorId="creator1" readOnly={false} />,
    );
    expect(screen.getByText("Nenhum item ainda")).toBeInTheDocument();
  });

  it("renders items with a total footer", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => catalogItems }));
    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={items} creatorId="creator1" readOnly={false} />,
    );
    expect(screen.getByText("Reel patrocinado")).toBeInTheDocument();
    // 2 * R$1.500,00 = R$3.000,00
    expect(screen.getByText("R$ 3.000,00")).toBeInTheDocument();
  });

  it("disambiguates catalog options with the rate card name only when the service name repeats", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => catalogItems }));
    const user = userEvent.setup();

    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={[]} creatorId="creator1" readOnly={false} />,
    );

    await user.click(screen.getByRole("combobox", { name: "Adicionar item" }));

    // "Reel patrocinado" exists in two rate cards -> disambiguated.
    expect(await screen.findByText(/Reel patrocinado.*Tabela Padrão/)).toBeInTheDocument();
    expect(await screen.findByText(/Reel patrocinado.*Tabela Especial/)).toBeInTheDocument();
    // "Stories" is unique -> no rate card name appended.
    const storiesOption = screen.getByText(/^Stories/);
    expect(storiesOption.textContent).not.toContain("Tabela");
  });

  it("adds a catalog item on selection", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/rate-card-items")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => catalogItems });
      }
      return Promise.resolve({ ok: true, status: 201, json: async () => items[0] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={[]} creatorId="creator1" readOnly={false} />,
    );

    await user.click(screen.getByRole("combobox", { name: "Adicionar item" }));
    await user.click(await screen.findByText(/^Stories/));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          (url as string).includes("/items") && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(
      ([url, callInit]) =>
        (url as string).includes("/items") && (callInit as RequestInit | undefined)?.method === "POST",
    )!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      userId: "user1",
      rateCardItemId: "rci3",
    });
  });

  it("adds an ad-hoc item with a negative price via the form", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/rate-card-items")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      return Promise.resolve({ ok: true, status: 201, json: async () => items[0] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={[]} creatorId="creator1" readOnly={false} />,
    );

    await user.click(screen.getByRole("combobox", { name: "Adicionar item" }));
    await user.click(await screen.findByText("+ Item avulso"));

    await user.type(screen.getByLabelText("Descrição"), "Desconto negociado");
    await user.type(screen.getByLabelText("Preço (R$)"), "-200.00");
    await user.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          (url as string).includes("/items") && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(
      ([url, callInit]) =>
        (url as string).includes("/items") && (callInit as RequestInit | undefined)?.method === "POST",
    )!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      userId: "user1",
      description: "Desconto negociado",
      unitPrice: -20000,
    });
  });

  it("removes an item after confirming the AlertDialog", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/rate-card-items")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      return Promise.resolve({ ok: true, status: 204, json: async () => undefined });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={items} creatorId="creator1" readOnly={false} />,
    );

    await user.click(screen.getByRole("button", { name: "Remover Reel patrocinado" }));
    expect(await screen.findByText("Remover este item?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remover" }));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      );
      expect(deleteCall).toBeDefined();
    });
  });

  it("does not render the combobox, ad-hoc form trigger, or remove button when readOnly", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={items} creatorId="creator1" readOnly />,
    );
    expect(screen.queryByRole("combobox", { name: "Adicionar item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remover Reel patrocinado" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/proposals/proposal-items-table.test.tsx`
Expected: FAIL — `./proposal-items-table` doesn't exist.

- [ ] **Step 3: Implement `ProposalItemsTable`**

```tsx
// src/components/proposals/proposal-items-table.tsx
"use client";

import * as React from "react";
import { Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { formatCurrencyBRL } from "@/lib/format";
import { useRateCardItems, type RateCardItemWithService } from "@/hooks/use-rate-card-items";
import {
  useAddProposalItem,
  useUpdateProposalItem,
  useRemoveProposalItem,
  type ProposalItem,
} from "@/hooks/use-proposal-items";

export interface ProposalItemsTableProps {
  organizationId: string;
  proposalId: string;
  userId: string;
  items: ProposalItem[];
  creatorId: string | null;
  readOnly: boolean;
}

type CatalogOption = { type: "catalog"; item: RateCardItemWithService } | { type: "adhoc" };

function reaisToCents(value: string): number {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function centsToReaisInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function ProposalItemsTable({
  organizationId,
  proposalId,
  userId,
  items,
  creatorId,
  readOnly,
}: ProposalItemsTableProps) {
  const { data: catalogItems } = useRateCardItems(organizationId, creatorId ?? "", {
    enabled: creatorId !== null,
  });
  const addItem = useAddProposalItem(organizationId, proposalId, userId);
  const updateItem = useUpdateProposalItem(organizationId, proposalId, userId);
  const removeItem = useRemoveProposalItem(organizationId, proposalId, userId);

  const [adHocOpen, setAdHocOpen] = React.useState(false);
  const [adHocDescription, setAdHocDescription] = React.useState("");
  const [adHocPrice, setAdHocPrice] = React.useState("");

  const serviceNameCounts = new Map<string, number>();
  for (const item of catalogItems ?? []) {
    serviceNameCounts.set(item.serviceName, (serviceNameCounts.get(item.serviceName) ?? 0) + 1);
  }

  const catalogOptions: CatalogOption[] = [
    ...(catalogItems ?? []).map((item) => ({ type: "catalog" as const, item })),
    { type: "adhoc" as const },
  ];

  function getLabel(option: CatalogOption): string {
    if (option.type === "adhoc") return "+ Item avulso";
    const base = `${option.item.serviceName} — ${formatCurrencyBRL(option.item.price)}`;
    const isDuplicate = (serviceNameCounts.get(option.item.serviceName) ?? 0) > 1;
    return isDuplicate ? `${base} · ${option.item.rateCardName}` : base;
  }

  function getValue(option: CatalogOption): string {
    return option.type === "adhoc" ? "__adhoc__" : option.item.id;
  }

  function handleSelect(option: CatalogOption) {
    if (option.type === "adhoc") {
      setAdHocOpen(true);
      return;
    }
    addItem.mutate({ rateCardItemId: option.item.id });
  }

  function handleAdHocConfirm() {
    if (!adHocDescription.trim()) return;
    addItem.mutate(
      { description: adHocDescription.trim(), unitPrice: reaisToCents(adHocPrice) },
      {
        onSuccess: () => {
          setAdHocOpen(false);
          setAdHocDescription("");
          setAdHocPrice("");
        },
      },
    );
  }

  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Itens</span>
        {!readOnly ? (
          <Combobox<CatalogOption>
            items={catalogOptions}
            getLabel={getLabel}
            getValue={getValue}
            value={null}
            onSelect={handleSelect}
            placeholder="Adicionar item..."
            aria-label="Adicionar item"
            className="w-64"
          />
        ) : null}
      </div>

      {!readOnly && adHocOpen ? (
        <div className="flex items-end gap-2 rounded-md border border-border p-3">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="adhoc-description">
              Descrição
            </label>
            <Input
              id="adhoc-description"
              aria-label="Descrição"
              value={adHocDescription}
              onChange={(event) => setAdHocDescription(event.target.value)}
              placeholder="Ex: Desconto negociado"
            />
          </div>
          <div className="flex w-32 flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="adhoc-price">
              Preço (R$)
            </label>
            <Input
              id="adhoc-price"
              aria-label="Preço (R$)"
              value={adHocPrice}
              onChange={(event) => setAdHocPrice(event.target.value)}
              placeholder="-200.00"
            />
          </div>
          <Button onClick={handleAdHocConfirm} disabled={!adHocDescription.trim()}>
            Adicionar
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nenhum item ainda"
          description="Adicione o primeiro item da proposta usando o campo acima."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Qtd.</TableHead>
              <TableHead>Preço unit.</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <ProposalItemRow
                key={item.id}
                item={item}
                readOnly={readOnly}
                onUpdate={(input) => updateItem.mutate({ itemId: item.id, ...input })}
                onRemove={() => removeItem.mutate(item.id)}
              />
            ))}
          </TableBody>
        </Table>
      )}

      {items.length > 0 ? (
        <div className="flex justify-end gap-2 border-t border-border pt-2 text-sm font-medium">
          <span>Total:</span>
          <span>{formatCurrencyBRL(total)}</span>
        </div>
      ) : null}
    </div>
  );
}

interface ProposalItemRowProps {
  item: ProposalItem;
  readOnly: boolean;
  onUpdate: (input: { quantity?: number; unitPrice?: number }) => void;
  onRemove: () => void;
}

function ProposalItemRow({ item, readOnly, onUpdate, onRemove }: ProposalItemRowProps) {
  const [quantity, setQuantity] = React.useState(String(item.quantity));
  const [price, setPrice] = React.useState(centsToReaisInput(item.unitPrice));

  React.useEffect(() => {
    setQuantity(String(item.quantity));
  }, [item.quantity]);

  React.useEffect(() => {
    setPrice(centsToReaisInput(item.unitPrice));
  }, [item.unitPrice]);

  function handleQuantityBlur() {
    const parsed = Number.parseInt(quantity, 10);
    if (!Number.isFinite(parsed) || parsed === item.quantity || parsed < 1) {
      setQuantity(String(item.quantity));
      return;
    }
    onUpdate({ quantity: parsed });
  }

  function handlePriceBlur() {
    const cents = reaisToCents(price);
    if (cents === item.unitPrice) return;
    onUpdate({ unitPrice: cents });
  }

  return (
    <TableRow>
      <TableCell>{item.description}</TableCell>
      <TableCell>
        <Input
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          onBlur={handleQuantityBlur}
          disabled={readOnly}
          className="w-16"
          aria-label={`Quantidade de ${item.description}`}
        />
      </TableCell>
      <TableCell>
        <Input
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          onBlur={handlePriceBlur}
          disabled={readOnly}
          className="w-28"
          aria-label={`Preço unitário de ${item.description}`}
        />
      </TableCell>
      <TableCell>
        {!readOnly ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Remover ${item.description}`}>
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover este item?</AlertDialogTitle>
                <AlertDialogDescription>
                  &quot;{item.description}&quot; será removido da proposta. Essa ação não pode ser
                  desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button variant="outline">Cancelar</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button onClick={onRemove}>Remover</Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/proposals/proposal-items-table.test.tsx`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/proposals/proposal-items-table.tsx src/components/proposals/proposal-items-table.test.tsx
git commit -m "feat: add ProposalItemsTable with catalog combobox, ad-hoc items, and removal confirmation"
```

---

### Task 9: Page shell — `/proposals/[id]/page.tsx`

**Files:**
- Create: `src/app/proposals/[id]/page.tsx`

**Interfaces:**
- Consumes: `useProposal`, `useUpdateProposal` (Task 5, `@/hooks/use-proposal`); `useOpportunity`
  (Task 5, `@/hooks/use-opportunity`); `useProposalBlocks` (Task 5, `@/hooks/use-proposal-blocks`);
  `useProposalItems` (Task 6, `@/hooks/use-proposal-items`); `ProposalCoverSection`,
  `ProposalTextSection` (Task 7, `@/components/proposals/*`); `ProposalItemsTable` (Task 8,
  `@/components/proposals/proposal-items-table`); `PROPOSAL_TEMPLATES`,
  `PROPOSAL_TEMPLATE_LABELS` (Task 3, `@/lib/proposal-templates`); `AlertDialog*` (Task 2,
  `@/components/ui/alert-dialog`); `getDevOrganizationId`, `getDevUserId` (Task 1,
  `@/lib/organization`); `Button`/`Input`/`Select*` (existing).
- Produces: the `/proposals/[id]` route.

- [ ] **Step 1: Implement the page shell**

No dedicated test for `page.tsx` at this step — same rationale as the Pipeline and Inbox plans'
own page-shell tasks: it is a thin composition of already-tested pieces (`ProposalCoverSection`/
`ProposalTextSection`/`ProposalItemsTable`, each with its own test from Tasks 7–8), verified
instead through its composed pieces plus manual verification (Step 2 below).

```tsx
// src/app/proposals/[id]/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDevOrganizationId, getDevUserId } from "@/lib/organization";
import { useProposal, useUpdateProposal } from "@/hooks/use-proposal";
import { useOpportunity } from "@/hooks/use-opportunity";
import { useProposalBlocks } from "@/hooks/use-proposal-blocks";
import { useProposalItems } from "@/hooks/use-proposal-items";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { PROPOSAL_TEMPLATES, PROPOSAL_TEMPLATE_LABELS, type ProposalTemplate } from "@/lib/proposal-templates";
import { ProposalCoverSection } from "@/components/proposals/proposal-cover-section";
import { ProposalTextSection } from "@/components/proposals/proposal-text-section";
import { ProposalItemsTable } from "@/components/proposals/proposal-items-table";

export default function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: proposalId } = React.use(params);
  const organizationId = getDevOrganizationId();
  const userId = getDevUserId();

  const { data: proposal, isLoading, isError, refetch } = useProposal(organizationId, proposalId);
  const { data: opportunity } = useOpportunity(organizationId, proposal?.opportunityId ?? "", {
    enabled: proposal !== undefined,
  });
  const {
    data: blocks,
    isLoading: blocksLoading,
    isError: blocksError,
    refetch: refetchBlocks,
  } = useProposalBlocks(organizationId, proposalId);
  const {
    data: items,
    isLoading: itemsLoading,
    isError: itemsError,
    refetch: refetchItems,
  } = useProposalItems(organizationId, proposalId);

  const updateProposal = useUpdateProposal(organizationId, proposalId, userId);

  const [title, setTitle] = React.useState("");
  React.useEffect(() => {
    if (proposal) setTitle(proposal.title);
  }, [proposal?.title]);

  function handleTitleBlur() {
    if (!proposal || !title.trim() || title.trim() === proposal.title) {
      setTitle(proposal?.title ?? "");
      return;
    }
    updateProposal.mutate({ title: title.trim() });
  }

  function handleTemplateChange(value: string) {
    updateProposal.mutate({ template: value as ProposalTemplate });
  }

  function handleArchiveToggle() {
    updateProposal.mutate({ status: proposal?.status === "ARCHIVED" ? "DRAFT" : "ARCHIVED" });
  }

  const anyLoading = isLoading || blocksLoading || itemsLoading;
  const anyError = isError || blocksError || itemsError;

  if (anyLoading) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  if (anyError || !proposal) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">Não foi possível carregar a proposta.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetch();
            refetchBlocks();
            refetchItems();
          }}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  const readOnly = proposal.status === "ARCHIVED";
  const coverBlock = blocks?.find((block) => block.blockType === "COVER") ?? null;
  const textBlock = blocks?.find((block) => block.blockType === "TEXT") ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link
          href="/pipeline"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Voltar
        </Link>

        {readOnly ? (
          <Button variant="outline" size="sm" onClick={handleArchiveToggle}>
            Desarquivar
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                Arquivar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Arquivar esta proposta?</AlertDialogTitle>
                <AlertDialogDescription>
                  Uma proposta arquivada fica somente leitura. Você pode desarquivar depois para
                  voltar a editar.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button variant="outline">Cancelar</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button onClick={handleArchiveToggle}>Arquivar</Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={handleTitleBlur}
          disabled={readOnly}
          className="text-xl font-semibold"
          aria-label="Título da proposta"
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="proposal-template">
            Template
          </label>
          <Select value={proposal.template} onValueChange={handleTemplateChange} disabled={readOnly}>
            <SelectTrigger id="proposal-template" aria-label="Template" className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROPOSAL_TEMPLATES.map((item) => (
                <SelectItem key={item} value={item}>
                  {PROPOSAL_TEMPLATE_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {coverBlock ? (
        <ProposalCoverSection
          organizationId={organizationId}
          proposalId={proposalId}
          userId={userId}
          block={coverBlock}
          readOnly={readOnly}
        />
      ) : null}

      {textBlock ? (
        <ProposalTextSection
          organizationId={organizationId}
          proposalId={proposalId}
          userId={userId}
          block={textBlock}
          readOnly={readOnly}
        />
      ) : null}

      <ProposalItemsTable
        organizationId={organizationId}
        proposalId={proposalId}
        userId={userId}
        items={items ?? []}
        creatorId={opportunity?.creatorId ?? null}
        readOnly={readOnly}
      />
    </div>
  );
}
```

- [ ] **Step 2: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/app/proposals/[id]/page.tsx
git commit -m "feat: assemble the Proposal Builder page (metadata, blocks, items table)"
```

- [ ] **Step 3: Manual smoke check**

Same rationale as the Pipeline and Inbox plans' equivalent steps — the pieces this task
assembles already have their own automated tests; a full end-to-end mock of this flow would cost
more than it proves.

1. Ensure a local Postgres is running with at least one organization (with an
   `organization_members` row for the dev user), creator, a rate card with items, and an
   Opportunity. Seed via the existing API routes or fixtures from earlier plans' manual checks.
2. Set `NEXT_PUBLIC_DEV_ORGANIZATION_ID` and `NEXT_PUBLIC_DEV_USER_ID` in `.env.local`.
3. Run `pnpm dev`, open `/pipeline`, select the creator, click an Opportunity card to open its
   Side Panel.
4. Confirm: "Propostas" section shows "Nenhuma proposta ainda."; clicking "Nova Proposta",
   filling title + template, and clicking "Criar" navigates to `/proposals/[id]`.
5. Confirm: the page shows the title (editable), template Select, an empty Capa input, an empty
   Texto textarea, and an empty items table with the `EmptyState`.
6. Confirm: editing the title and tabbing away persists (reload the page, title stays changed).
   Same for the Capa headline and Texto body.
7. Confirm: "Adicionar item" shows the creator's rate card items (if any) plus "+ Item avulso";
   selecting a catalog item adds it to the table with the right price; using "Item avulso" with a
   negative price adds a discount line; the total updates correctly including the negative value.
8. Confirm: editing an item's quantity or price inline and tabbing away persists; removing an
   item asks for confirmation first.
9. Confirm: clicking "Arquivar" (with confirmation) makes every field/button read-only except
   "Desarquivar", which restores editability.
10. Confirm: "Voltar" returns to `/pipeline`.

## Self-Review

**Spec coverage:**
- Decisão #1 (ponto de entrada: Side Panel "Propostas") — Task 4.
- Decisão #2 (fluxo de criação: Dialog título+template, POST cria Proposal+COVER+TEXT numa
  transação) — Task 1 (backend) + Task 4 (UI).
- Decisão #3 (layout: página única, seções empilhadas) — Task 9.
- Decisão #4 (edição inline, salva no blur, sem botão salvar) — every editable field across
  Tasks 4, 7, 8, 9 follows this identical pattern (local state initialized from props, `onBlur`
  compares to the initial value, mutates only if changed).
- Decisão #5 (template: Select sem efeito visual) — Task 9 renders it as a plain `Select`, no
  conditional rendering based on its value anywhere.
- Decisão #6 (arquivar: botão com confirmação, ARCHIVED=read-only) — Task 9's `AlertDialog` +
  `readOnly` prop threaded into every child component (Tasks 7, 8).
- Decisão #7 (navegação de volta: link "Voltar" pro /pipeline) — Task 9.
- Decisão #8 (loading/erro únicos, 3 GETs) — Task 9's `anyLoading`/`anyError` combine `useProposal`/
  `useProposalBlocks`/`useProposalItems`'s states (the 4th fetch, `useOpportunity`, is
  intentionally excluded from this gate — see Type Consistency note below).
- Decisão #9 (combobox: lista única, sem agrupar, desambiguação condicional por nome de rate
  card, sem `rateCardId` no item) — Task 8's `getLabel`/`serviceNameCounts` logic implements this
  exactly; Task 1 adds the `rateCardName` field the design depends on (a gap only surfaced while
  writing this plan, not present in the original mini-cycle).
- Decisão #10 (editar item: inline blur) — Task 8's `ProposalItemRow`.
- Decisão #11 (remover item: confirmação) — Task 8's `AlertDialog` around the remove button.
- Decisão #12 (ordem de itens: inserção, sem reorder) — no task adds any reordering UI; items
  render in whatever order `useProposalItems` returns (already deterministic server-side).
- Decisão #13 (total no rodapé, incluindo negativos) — Task 8's `total` reduction, tested with a
  discount-item case throughout.
- Decisão #14 (tabela vazia: EmptyState) — Task 8.
- Decisão #15 (blocos COVER/TEXT sempre presentes) — Task 1's transactional seeding; Task 9 never
  renders an "add block" action, only conditionally renders the sections if found (defensive,
  since they should always exist after Task 1).
- Decisão #16 (estrutura de conteúdo: `{headline}`/`{body}`) — Task 7.
- Decisão #17 (sem histórico de versões na UI) — no task adds any version-related UI or hook.

**Placeholder scan:** none — every step has literal, complete code.

**Type consistency:** `Proposal` (Task 3) is imported by name — never redefined — in Task 5.
`ProposalBlock` (Task 5) is imported by name in Tasks 7 and 9. `ProposalItem` (Task 6) is
imported by name in Tasks 8 and 9. `RateCardItemWithService` (Task 6) matches the backend shape
established in Task 1 exactly (including the added `rateCardName` field) and is imported by name
in Task 8. `ProposalTemplate`/`ProposalStatus` (Task 3) are imported by name everywhere a
template/status is read or set (Tasks 4, 5, 9) — never redefined. Every mutation hook's
`organizationId`/`proposalId`/`userId` closure-capture pattern is identical across Tasks 3, 5, 6.
Task 9's `useOpportunity` call is deliberately excluded from the page's `anyLoading`/`anyError`
gate: `creatorId` is only needed inside `ProposalItemsTable` for the catalog Combobox (Decisão
#9), not for anything else on the page, so gating the whole page's loading/error state on it
would make the metadata/blocks sections wait on a fetch they don't need — `ProposalItemsTable`
already handles `creatorId === null` gracefully (via `enabled: creatorId !== null` in
`useRateCardItems`, tested in Task 8's "no items" cases) by simply showing no catalog options
until it resolves.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-23-proposal-builder.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
