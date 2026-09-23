# Inbox Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Inbox screen at `/inbox` — the first of PublyFlow's three priority
screens — consuming the fully-ready backend and the Design System (base primitives + the five
components added in the Inbox Design System Additions plan).

**Architecture:** TanStack Query for all client-side data fetching/mutation (first screen to
need it — establishes the pattern future screens follow). A small `apiFetch` helper
standardizes JSON parsing and turns non-2xx responses into a typed `ApiError` carrying the
HTTP status, which the convert mutation's 422-ambiguity handling depends on. Data hooks live
in `src/hooks/`, screen-specific UI in `src/components/inbox/`, the route itself at
`src/app/inbox/page.tsx`. The whole page is a Client Component (organizationId comes from
`getDevOrganizationId()`, which reads a `NEXT_PUBLIC_` env var — safe to call client-side —
and creatorId comes from the existing client-side `useCreatorContext()`).

**Tech Stack:** Next.js 16 (Client Components), React 19, `@tanstack/react-query`, existing
Design System primitives (`Button`, `Badge`, `Card`, `Table`, `Dialog`, `Sheet`, `Select`,
`Textarea`, `Combobox`, `EmptyState`, `sonner`), Vitest + `@testing-library/react`.

## Global Constraints

- **API contracts** (from the approved spec, confirmed against merged code):
  - `GET /api/commercial-inquiries?organizationId=&creatorId=&status=` → `200` with an array
    of inquiry objects (fields: `id`, `organizationId`, `creatorId`, `messageId`, `status`
    (`NEW`|`DISCARDED`|`FALSE_POSITIVE`|`CONVERTED`), `companyGuess`, `brandGuess`,
    `contactNameGuess`, `budgetGuess`, `intentGuess`, `convertedLeadId`, `linkedOpportunityId`,
    `createdAt` (ISO string over the wire), `messageBody`, `messageReceivedAt` (ISO string),
    `externalContactLabel`, `source` (`INSTAGRAM`|`WHATSAPP`|`TIKTOK`), `conversationId`).
  - `POST /api/commercial-inquiries/[id]/convert` — body `{organizationId, contact: {id:
    string} | {fullName: string, email?: string|null, phone?: string|null}, companyId?:
    string|null, brandId?: string|null}` → `200` with `{inquiry, lead, opportunity}`; `404`
    inquiry not found; `409` inquiry already resolved; `422` ambiguous company/brand guess
    (`{error: string}` body in all three error cases — the UI distinguishes by HTTP status,
    not by inspecting the body).
  - `POST /api/commercial-inquiries/[id]/discard` — body `{organizationId}` → `204`.
  - `POST /api/commercial-inquiries/[id]/mark-false-positive` — body `{organizationId}` →
    `204`; `404`/`409` as above.
  - `POST /api/inbox/messages` — body `{organizationId, creatorId, source, externalContactLabel,
    body}` → `201`.
  - `GET /api/companies?organizationId=` / `GET /api/contacts?organizationId=` → `200` with
    full row arrays (`{id, organizationId, name, createdAt}` / `{id, organizationId, fullName,
    email, phone, companyId, createdAt}`) — used only for `id` + `name`/`fullName` by this
    plan's Combobox usage, nothing else.
- **422 handling**: when `/convert` returns `422`, the UI must NOT show a generic error toast
  — it falls back to the edit mode automatically with the message "Mais de uma empresa
  encontrada com esse nome — selecione a correta."
- **No pagination** anywhere — matches every other list in this project.
- **No new backend** — every hook in this plan only calls the endpoints listed above, exactly
  as they exist today.
- **Keyboard shortcuts** (`j`/`k`/`C`/`D`/`F`) must not fire while focus is inside an
  `input`, `textarea`, `select`, or the Combobox's search input — required per the approved
  spec, since the screen itself has text-entry surfaces (New Message form, edit-mode
  Combobox) where those same letters are typed normally. `Esc` closes the Side Panel.
- **Organization/creator source**: `getDevOrganizationId()` (from `src/lib/organization.ts`,
  already implemented) and `useCreatorContext()`'s `selectedCreatorId` (from
  `src/components/shell/creator-context.tsx`, already implemented) — no new mechanism.
- **No full conversation history, no fuzzy matching, no Kanban/Pipeline, no Proposal
  Builder** — out of scope, per the approved spec.

---

### Task 1: `apiFetch` helper + `ApiError`

**Files:**
- Create: `src/lib/api-client.ts`
- Test: `src/lib/api-client.test.ts`

**Interfaces:**
- Produces: `ApiError` (extends `Error`, has a `status: number` field) and
  `apiFetch<T>(url: string, init?: RequestInit): Promise<T>` from `src/lib/api-client.ts` —
  every data hook in this plan uses this instead of calling `fetch` directly. On a non-2xx
  response, throws `ApiError` with the response's status and, when the body is JSON with an
  `error` field, that message; otherwise falls back to `response.statusText`. A `204` response
  resolves to `undefined`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/api-client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch, ApiError } from "./api-client";

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed JSON on a 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "abc" }),
      }),
    );

    const result = await apiFetch<{ id: string }>("/api/example");
    expect(result).toEqual({ id: "abc" });
  });

  it("resolves to undefined on a 204 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 204 }),
    );

    const result = await apiFetch("/api/example");
    expect(result).toBeUndefined();
  });

  it("throws ApiError with the response status and error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({ error: "Multiple companies match" }),
      }),
    );

    await expect(apiFetch("/api/example")).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      message: "Multiple companies match",
    });
  });

  it("falls back to statusText when the error body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new Error("not json");
        },
      }),
    );

    await expect(apiFetch("/api/example")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/api-client.test.ts`
Expected: FAIL — `./api-client` doesn't exist.

- [ ] **Step 3: Implement `apiFetch`/`ApiError`**

```typescript
// src/lib/api-client.ts
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      if (body && typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      // Response body wasn't JSON -- keep the statusText fallback.
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/api-client.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/lib/api-client.ts src/lib/api-client.test.ts
git commit -m "feat: add apiFetch helper with typed ApiError"
```

---

### Task 2: TanStack Query provider

**Files:**
- Create: `src/components/providers/query-provider.tsx`
- Modify: `src/app/layout.tsx`
- Test: `src/components/providers/query-provider.test.tsx`

**Interfaces:**
- Produces: `QueryProvider({children})` from `src/components/providers/query-provider.tsx` —
  a Client Component wrapping `children` in `QueryClientProvider`, creating the `QueryClient`
  once per mount via `useState` (the standard Next.js App Router pattern — creating it at
  module scope would leak state across requests on the server).

- [ ] **Step 1: Install TanStack Query**

```bash
pnpm add @tanstack/react-query
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/components/providers/query-provider.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { QueryProvider } from "./query-provider";

function Probe() {
  const { data } = useQuery({
    queryKey: ["probe"],
    queryFn: async () => "query-client-is-wired",
  });
  return <span>{data ?? "loading"}</span>;
}

describe("QueryProvider", () => {
  it("provides a working QueryClient to its children", async () => {
    render(
      <QueryProvider>
        <Probe />
      </QueryProvider>,
    );

    expect(await screen.findByText("query-client-is-wired")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/components/providers/query-provider.test.tsx`
Expected: FAIL — `./query-provider` doesn't exist.

- [ ] **Step 4: Implement `QueryProvider`**

```typescript
// src/components/providers/query-provider.tsx
"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/providers/query-provider.test.tsx`
Expected: PASS

- [ ] **Step 6: Wire `QueryProvider` into the root layout**

Read the current content of `src/app/layout.tsx` in full first.

```typescript
// src/app/layout.tsx
// Add this import:
import { QueryProvider } from "@/components/providers/query-provider";

// Wrap the existing <CreatorProvider>...</CreatorProvider> (and the
// sibling <Toaster />) in <QueryProvider>, inside <body>:
      <body className="min-h-full">
        <QueryProvider>
          <CreatorProvider organizationId={organizationId} creators={creators}>
            {/* ...existing shell markup, unchanged... */}
          </CreatorProvider>
          <Toaster />
        </QueryProvider>
      </body>
```

- [ ] **Step 7: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add package.json pnpm-lock.yaml src/components/providers/query-provider.tsx src/components/providers/query-provider.test.tsx src/app/layout.tsx
git commit -m "feat: wire TanStack Query provider into the application shell"
```

---

### Task 3: `useCommercialInquiries` query hook

**Files:**
- Create: `src/hooks/use-commercial-inquiries.ts`
- Test: `src/hooks/use-commercial-inquiries.test.ts`

**Interfaces:**
- Consumes: `apiFetch` (Task 1).
- Produces: `CommercialInquiryListItem` type (the wire shape — same fields as the backend's
  `CommercialInquiryWithMessage`, but `createdAt`/`messageReceivedAt` typed as `string`, since
  `NextResponse.json` serializes `Date` to an ISO string over HTTP) and
  `useCommercialInquiries(organizationId: string, creatorId: string, status:
  "NEW"|"DISCARDED"|"FALSE_POSITIVE"|"CONVERTED"): UseQueryResult<CommercialInquiryListItem[]>`
  from `src/hooks/use-commercial-inquiries.ts`. The query key is
  `["commercial-inquiries", organizationId, creatorId, status]` — later tasks' mutations
  invalidate this exact key shape to trigger a refetch.

- [ ] **Step 1: Write the failing test**

```typescript
// src/hooks/use-commercial-inquiries.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCommercialInquiries } from "./use-commercial-inquiries";

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe({ organizationId, creatorId, status }: { organizationId: string; creatorId: string; status: "NEW" }) {
  const { data, isLoading } = useCommercialInquiries(organizationId, creatorId, status);
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} inquiries</span>;
}

describe("useCommercialInquiries", () => {
  it("fetches the list for the given organization/creator/status and requests the right URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "i1", messageBody: "Olá" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Probe organizationId="org1" creatorId="creator1" status="NEW" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 inquiries")).toBeInTheDocument();

    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toContain("organizationId=org1");
    expect(requestedUrl).toContain("creatorId=creator1");
    expect(requestedUrl).toContain("status=NEW");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-commercial-inquiries.test.ts`
Expected: FAIL — `./use-commercial-inquiries` doesn't exist.

- [ ] **Step 3: Implement `useCommercialInquiries`**

```typescript
// src/hooks/use-commercial-inquiries.ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export type InquiryStatus = "NEW" | "DISCARDED" | "FALSE_POSITIVE" | "CONVERTED";

export interface CommercialInquiryListItem {
  id: string;
  organizationId: string;
  creatorId: string;
  messageId: string;
  status: InquiryStatus;
  companyGuess: string | null;
  brandGuess: string | null;
  contactNameGuess: string | null;
  budgetGuess: string | null;
  intentGuess: string | null;
  convertedLeadId: string | null;
  linkedOpportunityId: string | null;
  createdAt: string;
  messageBody: string;
  messageReceivedAt: string;
  externalContactLabel: string;
  source: "INSTAGRAM" | "WHATSAPP" | "TIKTOK";
  conversationId: string;
}

export function commercialInquiriesQueryKey(
  organizationId: string,
  creatorId: string,
  status: InquiryStatus,
) {
  return ["commercial-inquiries", organizationId, creatorId, status] as const;
}

export function useCommercialInquiries(
  organizationId: string,
  creatorId: string,
  status: InquiryStatus,
): UseQueryResult<CommercialInquiryListItem[]> {
  return useQuery({
    queryKey: commercialInquiriesQueryKey(organizationId, creatorId, status),
    queryFn: () =>
      apiFetch<CommercialInquiryListItem[]>(
        `/api/commercial-inquiries?organizationId=${organizationId}&creatorId=${creatorId}&status=${status}`,
      ),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-commercial-inquiries.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/hooks/use-commercial-inquiries.ts src/hooks/use-commercial-inquiries.test.ts
git commit -m "feat: add useCommercialInquiries query hook"
```

---

### Task 4: Inquiry resolution mutations (convert/discard/mark-false-positive)

**Files:**
- Create: `src/hooks/use-inquiry-mutations.ts`
- Test: `src/hooks/use-inquiry-mutations.test.ts`

**Interfaces:**
- Consumes: `apiFetch`/`ApiError` (Task 1), `commercialInquiriesQueryKey` (Task 3).
- Produces (all from `src/hooks/use-inquiry-mutations.ts`):
  - `useConvertInquiry(organizationId, creatorId, status): UseMutationResult<ConvertResult,
    ApiError, ConvertInput>` — `ConvertInput = {inquiryId: string, contact: {id: string} |
    {fullName: string, email?: string | null, phone?: string | null}, companyId?: string |
    null, brandId?: string | null}`. `ConvertResult = {inquiry: unknown, lead: unknown,
    opportunity: unknown}` (the caller only needs to know the call succeeded; this plan
    doesn't consume the returned Lead/Opportunity shape). On success, invalidates
    `commercialInquiriesQueryKey(organizationId, creatorId, status)`. Does NOT catch or
    special-case the `422` `ApiError` itself — the caller (Task 8's edit-mode component)
    inspects `error.status` on failure to decide whether to fall back to edit mode; this hook
    stays a thin, generic mutation.
  - `useDiscardInquiry(organizationId, creatorId, status): UseMutationResult<void, ApiError,
    string>` — mutation function takes the `inquiryId` string directly. Invalidates the same
    query key on success.
  - `useMarkFalsePositiveInquiry(organizationId, creatorId, status): UseMutationResult<void,
    ApiError, string>` — same shape as `useDiscardInquiry`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/hooks/use-inquiry-mutations.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useConvertInquiry,
  useDiscardInquiry,
  useMarkFalsePositiveInquiry,
} from "./use-inquiry-mutations";
import { commercialInquiriesQueryKey } from "./use-commercial-inquiries";

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useDiscardInquiry", () => {
  it("POSTs to the discard endpoint and invalidates the inquiries list on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDiscardInquiry("org1", "creator1", "NEW"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate("inquiry1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/commercial-inquiries/inquiry1/discard");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ organizationId: "org1" });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: commercialInquiriesQueryKey("org1", "creator1", "NEW"),
    });
  });
});

describe("useMarkFalsePositiveInquiry", () => {
  it("POSTs to the mark-false-positive endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useMarkFalsePositiveInquiry("org1", "creator1", "NEW"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate("inquiry1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/commercial-inquiries/inquiry1/mark-false-positive");
  });
});

describe("useConvertInquiry", () => {
  it("POSTs contact/company/brand to the convert endpoint and surfaces an ApiError on 422", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: async () => ({ error: "Multiple companies match" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useConvertInquiry("org1", "creator1", "NEW"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ inquiryId: "inquiry1", contact: { fullName: "Maria" } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 422 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/commercial-inquiries/inquiry1/convert");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      contact: { fullName: "Maria" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-inquiry-mutations.test.ts`
Expected: FAIL — `./use-inquiry-mutations` doesn't exist.

- [ ] **Step 3: Implement the mutation hooks**

```typescript
// src/hooks/use-inquiry-mutations.ts
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";
import { commercialInquiriesQueryKey, type InquiryStatus } from "./use-commercial-inquiries";

export interface ConvertContactInput {
  id: string;
}

export interface ConvertNewContactInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
}

export interface ConvertInput {
  inquiryId: string;
  contact: ConvertContactInput | ConvertNewContactInput;
  companyId?: string | null;
  brandId?: string | null;
}

export interface ConvertResult {
  inquiry: unknown;
  lead: unknown;
  opportunity: unknown;
}

export function useConvertInquiry(
  organizationId: string,
  creatorId: string,
  status: InquiryStatus,
): UseMutationResult<ConvertResult, ApiError, ConvertInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inquiryId, contact, companyId, brandId }) =>
      apiFetch<ConvertResult>(`/api/commercial-inquiries/${inquiryId}/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, contact, companyId, brandId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: commercialInquiriesQueryKey(organizationId, creatorId, status),
      });
    },
  });
}

export function useDiscardInquiry(
  organizationId: string,
  creatorId: string,
  status: InquiryStatus,
): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inquiryId: string) =>
      apiFetch<void>(`/api/commercial-inquiries/${inquiryId}/discard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: commercialInquiriesQueryKey(organizationId, creatorId, status),
      });
    },
  });
}

export function useMarkFalsePositiveInquiry(
  organizationId: string,
  creatorId: string,
  status: InquiryStatus,
): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inquiryId: string) =>
      apiFetch<void>(`/api/commercial-inquiries/${inquiryId}/mark-false-positive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: commercialInquiriesQueryKey(organizationId, creatorId, status),
      });
    },
  });
}
```

Note that `ConvertInput.contact`'s two-variant shape mirrors the `/convert` route's own zod
union exactly (`{id}` vs `{fullName, email?, phone?}`), and the fetch body only stringifies
`companyId`/`brandId` when the caller passed them, preserving the `undefined`-vs-`null`
distinction the backend relies on (`JSON.stringify` drops `undefined` keys entirely, which is
exactly the "not provided, resolve from the guess" case; a caller-supplied `null` is preserved
as `null` in the JSON body).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-inquiry-mutations.test.ts`
Expected: PASS (all 3 test cases)

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/hooks/use-inquiry-mutations.ts src/hooks/use-inquiry-mutations.test.ts
git commit -m "feat: add convert/discard/mark-false-positive inquiry mutations"
```

---

### Task 5: Companies/Contacts list hooks + Send Message mutation

**Files:**
- Create: `src/hooks/use-party-options.ts`
- Create: `src/hooks/use-send-inbox-message.ts`
- Test: `src/hooks/use-party-options.test.ts`
- Test: `src/hooks/use-send-inbox-message.test.ts`

**Interfaces:**
- Consumes: `apiFetch` (Task 1).
- Produces: `PartyOption` type (`{id: string, label: string}` — a minimal, Combobox-ready
  shape; deliberately NOT the full `Company`/`Contact` repository types, since this plan only
  ever needs `id` + a display label, and reusing the full types would drag in `createdAt`
  Date-vs-string handling this feature has no use for), `useCompanyOptions(organizationId:
  string): UseQueryResult<PartyOption[]>`, `useContactOptions(organizationId: string):
  UseQueryResult<PartyOption[]>` from `src/hooks/use-party-options.ts` — consumed by Task 8's
  edit-mode Combobox wiring.
- Produces: `SendMessageInput = {organizationId: string, creatorId: string, source:
  "INSTAGRAM"|"WHATSAPP"|"TIKTOK", externalContactLabel: string, body: string}` and
  `useSendInboxMessage(): UseMutationResult<unknown, ApiError, SendMessageInput>` from
  `src/hooks/use-send-inbox-message.ts` — consumed by Task 9's New Message Sheet. This
  mutation does NOT take a fixed `organizationId`/`creatorId`/`status` at hook-creation time
  (unlike Task 4's mutations) because it doesn't need to invalidate a specific inquiries-list
  query itself — Task 9's form invalidates the "NEW" tab's query directly after a successful
  send, since that's the only tab a new message could ever land in.

- [ ] **Step 1: Write the failing test for `use-party-options`**

```typescript
// src/hooks/use-party-options.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCompanyOptions, useContactOptions } from "./use-party-options";

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useCompanyOptions", () => {
  it("maps companies into {id, label} options", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ id: "c1", organizationId: "org1", name: "Bella Cosméticos", createdAt: "2026-01-01" }],
      }),
    );

    const { result } = renderHook(() => useCompanyOptions("org1"), {
      wrapper: wrapper(new QueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "c1", label: "Bella Cosméticos" }]);
  });
});

describe("useContactOptions", () => {
  it("maps contacts into {id, label} options using fullName", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { id: "ct1", organizationId: "org1", fullName: "Maria", email: null, phone: null, companyId: null, createdAt: "2026-01-01" },
        ],
      }),
    );

    const { result } = renderHook(() => useContactOptions("org1"), {
      wrapper: wrapper(new QueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "ct1", label: "Maria" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-party-options.test.ts`
Expected: FAIL — `./use-party-options` doesn't exist.

- [ ] **Step 3: Implement `use-party-options`**

```typescript
// src/hooks/use-party-options.ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface PartyOption {
  id: string;
  label: string;
}

export function useCompanyOptions(organizationId: string): UseQueryResult<PartyOption[]> {
  return useQuery({
    queryKey: ["company-options", organizationId],
    queryFn: async () => {
      const companies = await apiFetch<{ id: string; name: string }[]>(
        `/api/companies?organizationId=${organizationId}`,
      );
      return companies.map((company) => ({ id: company.id, label: company.name }));
    },
  });
}

export function useContactOptions(organizationId: string): UseQueryResult<PartyOption[]> {
  return useQuery({
    queryKey: ["contact-options", organizationId],
    queryFn: async () => {
      const contacts = await apiFetch<{ id: string; fullName: string }[]>(
        `/api/contacts?organizationId=${organizationId}`,
      );
      return contacts.map((contact) => ({ id: contact.id, label: contact.fullName }));
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-party-options.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `use-send-inbox-message`**

```typescript
// src/hooks/use-send-inbox-message.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSendInboxMessage } from "./use-send-inbox-message";

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useSendInboxMessage", () => {
  it("POSTs the message payload to /api/inbox/messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ conversation: {}, message: {}, inquiry: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSendInboxMessage(), {
      wrapper: wrapper(new QueryClient()),
    });

    result.current.mutate({
      organizationId: "org1",
      creatorId: "creator1",
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores.",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/inbox/messages");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      creatorId: "creator1",
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores.",
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/use-send-inbox-message.test.ts`
Expected: FAIL — `./use-send-inbox-message` doesn't exist.

- [ ] **Step 7: Implement `useSendInboxMessage`**

```typescript
// src/hooks/use-send-inbox-message.ts
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";

export interface SendMessageInput {
  organizationId: string;
  creatorId: string;
  source: "INSTAGRAM" | "WHATSAPP" | "TIKTOK";
  externalContactLabel: string;
  body: string;
}

export function useSendInboxMessage(): UseMutationResult<unknown, ApiError, SendMessageInput> {
  return useMutation({
    mutationFn: (input: SendMessageInput) =>
      apiFetch("/api/inbox/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
  });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/hooks/use-send-inbox-message.test.ts`
Expected: PASS

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/hooks/use-party-options.ts src/hooks/use-party-options.test.ts src/hooks/use-send-inbox-message.ts src/hooks/use-send-inbox-message.test.ts
git commit -m "feat: add company/contact option hooks and send-message mutation"
```

---

### Task 6: Inbox page shell — status tabs, list, empty state

**Files:**
- Create: `src/app/inbox/page.tsx`
- Create: `src/components/inbox/inquiry-list.tsx`
- Test: `src/components/inbox/inquiry-list.test.tsx`

**Interfaces:**
- Consumes: `useCommercialInquiries`/`CommercialInquiryListItem`/`InquiryStatus` (Task 3),
  `useCreatorContext` (existing, `src/components/shell/creator-context.tsx`),
  `getDevOrganizationId` (existing, `src/lib/organization.ts`), `Table`/`TableHeader`/
  `TableBody`/`TableRow`/`TableHead`/`TableCell` (existing), `Badge` (existing), `EmptyState`
  (Inbox Design System Additions plan), `Button` (existing).
- Produces: `InquiryList` from `src/components/inbox/inquiry-list.tsx` — props `{inquiries:
  CommercialInquiryListItem[], selectedId: string | null, onSelect: (inquiry:
  CommercialInquiryListItem) => void}`. Renders one row per inquiry (remetente, empresa/marca,
  trecho da mensagem, canal, tempo relativo); clicking a row calls `onSelect`. Consumed by
  `src/app/inbox/page.tsx`, which Task 7 extends with the Side Panel.
- Produces: the `/inbox` route itself, rendering the four status tabs (this task wires tab
  switching + the list + empty state; Task 7 adds the Side Panel on row selection, Task 9 adds
  the "Nova Mensagem" button's Sheet, Task 10 adds keyboard shortcuts — all as extensions to
  this same file in later tasks, not a rewrite).

- [ ] **Step 1: Write the failing test for `InquiryList`**

```typescript
// src/components/inbox/inquiry-list.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import { InquiryList } from "./inquiry-list";

const inquiries: CommercialInquiryListItem[] = [
  {
    id: "i1",
    organizationId: "org1",
    creatorId: "creator1",
    messageId: "m1",
    status: "NEW",
    companyGuess: "Bella Cosméticos",
    brandGuess: null,
    contactNameGuess: "Maria",
    budgetGuess: null,
    intentGuess: "Pedido de mídia kit",
    convertedLeadId: null,
    linkedOpportunityId: null,
    createdAt: "2026-01-01T12:00:00.000Z",
    messageBody: "Olá, gostaríamos de saber os valores para uma campanha de verão.",
    messageReceivedAt: "2026-01-01T12:00:00.000Z",
    externalContactLabel: "Maria — Bella Cosméticos",
    source: "INSTAGRAM",
    conversationId: "conv1",
  },
];

describe("InquiryList", () => {
  it("renders one row per inquiry and calls onSelect when a row is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<InquiryList inquiries={inquiries} selectedId={null} onSelect={onSelect} />);

    expect(screen.getByText("Maria — Bella Cosméticos")).toBeInTheDocument();
    expect(screen.getByText("Bella Cosméticos")).toBeInTheDocument();

    await user.click(screen.getByText("Maria — Bella Cosméticos"));
    expect(onSelect).toHaveBeenCalledWith(inquiries[0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/inbox/inquiry-list.test.tsx`
Expected: FAIL — `./inquiry-list` doesn't exist.

- [ ] **Step 3: Implement `InquiryList`**

```typescript
// src/components/inbox/inquiry-list.tsx
"use client";

import { Camera, MessageCircle, Music2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";

// lucide-react has no brand-specific Instagram/WhatsApp/TikTok icons (they
// were removed upstream) -- these are neutral stand-ins, easy to swap
// later without touching any consumer of this map.
const SOURCE_ICON = {
  INSTAGRAM: Camera,
  WHATSAPP: MessageCircle,
  TIKTOK: Music2,
} as const;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.round(hours / 24);
  return `há ${days}d`;
}

export interface InquiryListProps {
  inquiries: CommercialInquiryListItem[];
  selectedId: string | null;
  onSelect: (inquiry: CommercialInquiryListItem) => void;
}

export function InquiryList({ inquiries, selectedId, onSelect }: InquiryListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Remetente</TableHead>
          <TableHead>Empresa/Marca</TableHead>
          <TableHead>Mensagem</TableHead>
          <TableHead>Canal</TableHead>
          <TableHead>Recebido</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {inquiries.map((inquiry) => {
          const SourceIcon = SOURCE_ICON[inquiry.source];
          return (
            <TableRow
              key={inquiry.id}
              onClick={() => onSelect(inquiry)}
              className={cn("cursor-pointer", selectedId === inquiry.id && "bg-primary/10")}
            >
              <TableCell>{inquiry.externalContactLabel}</TableCell>
              <TableCell>{inquiry.companyGuess ?? inquiry.brandGuess ?? "—"}</TableCell>
              <TableCell className="max-w-xs truncate text-muted-foreground">
                {inquiry.messageBody}
              </TableCell>
              <TableCell>
                <SourceIcon className="size-4 text-muted-foreground" />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {relativeTime(inquiry.messageReceivedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/inbox/inquiry-list.test.tsx`
Expected: PASS

- [ ] **Step 5: Implement the page shell**

No dedicated test for `page.tsx` at this step — it's a thin composition of `InquiryList`
(just tested) plus tab-switching state, both already-proven pieces; Task 7's Side Panel
addition is what makes the page meaningfully interactive enough to warrant its own test,
added then.

```typescript
// src/app/inbox/page.tsx
"use client";

import * as React from "react";
import { Inbox as InboxIcon } from "lucide-react";
import { getDevOrganizationId } from "@/lib/organization";
import { useCreatorContext } from "@/components/shell/creator-context";
import { useCommercialInquiries, type InquiryStatus } from "@/hooks/use-commercial-inquiries";
import { EmptyState } from "@/components/ui/empty-state";
import { InquiryList } from "@/components/inbox/inquiry-list";

const TABS: { value: InquiryStatus; label: string }[] = [
  { value: "NEW", label: "Novas" },
  { value: "CONVERTED", label: "Convertidas" },
  { value: "DISCARDED", label: "Descartadas" },
  { value: "FALSE_POSITIVE", label: "Falsos Positivos" },
];

export default function InboxPage() {
  const organizationId = getDevOrganizationId();
  const { selectedCreatorId } = useCreatorContext();
  const [activeTab, setActiveTab] = React.useState<InquiryStatus>("NEW");

  const { data: inquiries, isLoading } = useCommercialInquiries(
    organizationId,
    selectedCreatorId ?? "",
    activeTab,
  );

  if (!selectedCreatorId) {
    return (
      <EmptyState
        icon={InboxIcon}
        title="Selecione um creator"
        description="Escolha um creator no seletor do header para ver o Inbox."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inbox</h1>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={
              tab.value === activeTab
                ? "border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary"
                : "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : !inquiries || inquiries.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title={activeTab === "NEW" ? "Nenhuma mensagem nova" : "Nada por aqui"}
          description={
            activeTab === "NEW" ? "Novas mensagens comerciais aparecem aqui." : undefined
          }
        />
      ) : (
        <InquiryList inquiries={inquiries} selectedId={null} onSelect={() => {}} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/app/inbox/page.tsx src/components/inbox/inquiry-list.tsx src/components/inbox/inquiry-list.test.tsx
git commit -m "feat: add Inbox page shell with status tabs and inquiry list"
```

---

### Task 7: Side Panel — detail view + 1-click actions

**Files:**
- Create: `src/components/inbox/inquiry-side-panel.tsx`
- Modify: `src/app/inbox/page.tsx`
- Test: `src/components/inbox/inquiry-side-panel.test.tsx`

**Interfaces:**
- Consumes: `useConvertInquiry`/`useDiscardInquiry`/`useMarkFalsePositiveInquiry` (Task 4),
  `Sheet`/`SheetContent`/`SheetTitle`/`SheetDescription` (existing), `Button` (existing),
  `toast` (from `sonner`, wired in the Inbox Design System Additions plan).
- Produces: `InquirySidePanel` from `src/components/inbox/inquiry-side-panel.tsx` — props
  `{inquiry: CommercialInquiryListItem | null, open: boolean, onOpenChange: (open: boolean) =>
  void, organizationId: string, creatorId: string, status: InquiryStatus}`. Renders the full
  message + AI guesses when `inquiry` is set; the 1-click actions (Converter/Descartar/Falso
  Positivo). On a successful discard/mark-false-positive, shows a toast and closes (via
  `onOpenChange(false)`). On convert success, same. On convert failure with `error.status ===
  422`, this task's version does NOT yet fall back to edit mode (that's Task 8) — it shows a
  clear toast: "Mais de uma empresa encontrada com esse nome — selecione a correta." (matching
  the spec's required wording) so the behavior is already correct and observable before Task 8
  adds the actual edit UI; any other convert failure shows a generic error toast with
  `error.message`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/inbox/inquiry-side-panel.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import { InquirySidePanel } from "./inquiry-side-panel";

afterEach(() => {
  vi.unstubAllGlobals();
});

const inquiry: CommercialInquiryListItem = {
  id: "i1",
  organizationId: "org1",
  creatorId: "creator1",
  messageId: "m1",
  status: "NEW",
  companyGuess: "Bella Cosméticos",
  brandGuess: null,
  contactNameGuess: "Maria",
  budgetGuess: null,
  intentGuess: "Pedido de mídia kit",
  convertedLeadId: null,
  linkedOpportunityId: null,
  createdAt: "2026-01-01T12:00:00.000Z",
  messageBody: "Olá, gostaríamos de saber os valores.",
  messageReceivedAt: "2026-01-01T12:00:00.000Z",
  externalContactLabel: "Maria — Bella Cosméticos",
  source: "INSTAGRAM",
  conversationId: "conv1",
};

function renderPanel(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <InquirySidePanel
        inquiry={inquiry}
        open
        onOpenChange={onOpenChange}
        organizationId="org1"
        creatorId="creator1"
        status="NEW"
      />
      <Toaster />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe("InquirySidePanel", () => {
  it("shows the full message and discards the inquiry on click, then closes", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    const { onOpenChange } = renderPanel();

    expect(screen.getByText("Olá, gostaríamos de saber os valores.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Descartar" }));

    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(await screen.findByText(/Descartada/)).toBeInTheDocument();
  });

  it("shows a clear message (not a generic error) when convert fails with 422", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({ error: "Multiple companies match" }),
      }),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Converter em Opportunity" }));

    expect(
      await screen.findByText(/Mais de uma empresa encontrada com esse nome/),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/inbox/inquiry-side-panel.test.tsx`
Expected: FAIL — `./inquiry-side-panel` doesn't exist.

- [ ] **Step 3: Implement `InquirySidePanel`**

```typescript
// src/components/inbox/inquiry-side-panel.tsx
"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import type { InquiryStatus } from "@/hooks/use-commercial-inquiries";
import {
  useConvertInquiry,
  useDiscardInquiry,
  useMarkFalsePositiveInquiry,
} from "@/hooks/use-inquiry-mutations";
import { ApiError } from "@/lib/api-client";

export interface InquirySidePanelProps {
  inquiry: CommercialInquiryListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  creatorId: string;
  status: InquiryStatus;
}

export function InquirySidePanel({
  inquiry,
  open,
  onOpenChange,
  organizationId,
  creatorId,
  status,
}: InquirySidePanelProps) {
  const convert = useConvertInquiry(organizationId, creatorId, status);
  const discard = useDiscardInquiry(organizationId, creatorId, status);
  const markFalsePositive = useMarkFalsePositiveInquiry(organizationId, creatorId, status);

  if (!inquiry) return null;

  function handleConvert() {
    convert.mutate(
      { inquiryId: inquiry!.id, contact: { fullName: inquiry!.contactNameGuess ?? "Desconhecido" } },
      {
        onSuccess: () => {
          toast.success("Convertida em Opportunity");
          onOpenChange(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 422) {
            toast.error("Mais de uma empresa encontrada com esse nome — selecione a correta.");
            return;
          }
          toast.error(error.message);
        },
      },
    );
  }

  function handleDiscard() {
    discard.mutate(inquiry!.id, {
      onSuccess: () => {
        toast.success("Descartada");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function handleMarkFalsePositive() {
    markFalsePositive.mutate(inquiry!.id, {
      onSuccess: () => {
        toast.success("Marcada como falso positivo");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{inquiry.externalContactLabel}</SheetTitle>
          <SheetDescription>{inquiry.messageBody}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 text-sm">
          {inquiry.companyGuess ? (
            <p>
              <span className="text-muted-foreground">Empresa (IA): </span>
              {inquiry.companyGuess}
            </p>
          ) : null}
          {inquiry.brandGuess ? (
            <p>
              <span className="text-muted-foreground">Marca (IA): </span>
              {inquiry.brandGuess}
            </p>
          ) : null}
          {inquiry.budgetGuess ? (
            <p>
              <span className="text-muted-foreground">Orçamento (IA): </span>
              {inquiry.budgetGuess}
            </p>
          ) : null}
          {inquiry.intentGuess ? (
            <p>
              <span className="text-muted-foreground">Intenção (IA): </span>
              {inquiry.intentGuess}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={handleConvert} disabled={convert.isPending}>
            Converter em Opportunity
          </Button>
          <Button variant="outline" onClick={handleDiscard} disabled={discard.isPending}>
            Descartar
          </Button>
          <Button
            variant="ghost"
            onClick={handleMarkFalsePositive}
            disabled={markFalsePositive.isPending}
          >
            Falso Positivo
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/inbox/inquiry-side-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the Side Panel into the page**

Read the current content of `src/app/inbox/page.tsx` (Task 6) in full first.

```typescript
// src/app/inbox/page.tsx
// Add this import:
import { InquirySidePanel } from "@/components/inbox/inquiry-side-panel";

// Add state for the selected inquiry, inside InboxPage:
  const [selectedInquiry, setSelectedInquiry] = React.useState<CommercialInquiryListItem | null>(
    null,
  );

// Import the type used above:
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";

// Replace the InquiryList usage:
        <InquiryList
          inquiries={inquiries}
          selectedId={selectedInquiry?.id ?? null}
          onSelect={setSelectedInquiry}
        />

// Add the Side Panel as a sibling of the main content, at the end of the
// returned JSX (still inside the outer <div>):
      <InquirySidePanel
        inquiry={selectedInquiry}
        open={selectedInquiry !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedInquiry(null);
        }}
        organizationId={organizationId}
        creatorId={selectedCreatorId}
        status={activeTab}
      />
```

- [ ] **Step 6: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/inbox/inquiry-side-panel.tsx src/components/inbox/inquiry-side-panel.test.tsx src/app/inbox/page.tsx
git commit -m "feat: add Inquiry Side Panel with 1-click convert/discard/false-positive actions"
```

---

### Task 8: Edit mode — Combobox wiring + automatic 422 fallback

**Files:**
- Create: `src/components/inbox/inquiry-edit-form.tsx`
- Modify: `src/components/inbox/inquiry-side-panel.tsx`
- Test: `src/components/inbox/inquiry-edit-form.test.tsx`
- Test: `src/components/inbox/inquiry-side-panel.test.tsx` (extended)

**Interfaces:**
- Consumes: `useCompanyOptions`/`useContactOptions`/`PartyOption` (Task 5), `Combobox`
  (Inbox Design System Additions plan), `Button`/`Input` (existing).
- Produces: `InquiryEditForm` from `src/components/inbox/inquiry-edit-form.tsx` — props
  `{organizationId: string, initialCompanyName: string | null, initialContactName: string |
  null, onConfirm: (input: {contact: {id: string} | {fullName: string}, companyId?: string |
  null}) => void}`. Renders a Combobox for Company (pre-filtered by `initialCompanyName` as
  the starting query, so the ambiguous set is visible immediately) and a Combobox for Contact,
  each allowing either selecting an existing option or creating new by typed name. A "Confirmar"
  button calls `onConfirm` with the resolved selection.
- Modifies: `InquirySidePanel` gains an `editMode` state. `handleConvert`'s `onError` branch
  for `error.status === 422` now sets `editMode = true` (in addition to the toast) instead of
  only toasting; when `editMode` is true, the panel renders `InquiryEditForm` below the
  guessed-fields section instead of just the 1-click action row, and its `onConfirm` re-calls
  `convert.mutate` with the caller-resolved `contact`/`companyId`.

- [ ] **Step 1: Write the failing test for `InquiryEditForm`**

```typescript
// src/components/inbox/inquiry-edit-form.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InquiryEditForm } from "./inquiry-edit-form";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InquiryEditForm", () => {
  it("lets the assessora pick an existing company from the Combobox and confirms with its id", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/companies")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [
              { id: "c1", organizationId: "org1", name: "Bella Cosméticos Ltda", createdAt: "2026-01-01" },
              { id: "c2", organizationId: "org1", name: "Bella Cosméticos ME", createdAt: "2026-01-01" },
            ],
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }),
    );

    const onConfirm = vi.fn();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <InquiryEditForm
          organizationId="org1"
          initialCompanyName="Bella Cosméticos"
          initialContactName="Maria"
          onConfirm={onConfirm}
        />
      </QueryClientProvider>,
    );

    const companyCombobox = await screen.findByRole("combobox", { name: /empresa/i });
    await user.click(companyCombobox);
    const option = await screen.findByText("Bella Cosméticos Ltda");
    await user.click(option);

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "c1" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/inbox/inquiry-edit-form.test.tsx`
Expected: FAIL — `./inquiry-edit-form` doesn't exist.

- [ ] **Step 3: Implement `InquiryEditForm`**

```typescript
// src/components/inbox/inquiry-edit-form.tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useCompanyOptions, useContactOptions, type PartyOption } from "@/hooks/use-party-options";

export interface InquiryEditFormProps {
  organizationId: string;
  initialCompanyName: string | null;
  initialContactName: string | null;
  onConfirm: (input: { contact: { id: string } | { fullName: string }; companyId?: string | null }) => void;
}

export function InquiryEditForm({
  organizationId,
  initialCompanyName,
  initialContactName,
  onConfirm,
}: InquiryEditFormProps) {
  const { data: companyOptions = [] } = useCompanyOptions(organizationId);
  const { data: contactOptions = [] } = useContactOptions(organizationId);

  const [selectedCompany, setSelectedCompany] = React.useState<PartyOption | null>(null);
  const [newCompanyName, setNewCompanyName] = React.useState<string | null>(null);
  const [selectedContact, setSelectedContact] = React.useState<PartyOption | null>(null);
  const [newContactName, setNewContactName] = React.useState<string | null>(initialContactName);

  function handleConfirm() {
    const contact = selectedContact
      ? { id: selectedContact.id }
      : { fullName: newContactName ?? initialContactName ?? "Desconhecido" };

    onConfirm({
      contact,
      companyId: selectedCompany ? selectedCompany.id : newCompanyName ? undefined : null,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-company">
          Empresa
        </label>
        <Combobox<PartyOption>
          items={companyOptions}
          getLabel={(item) => item.label}
          getValue={(item) => item.id}
          value={selectedCompany?.id ?? null}
          onSelect={(item) => {
            setSelectedCompany(item);
            setNewCompanyName(null);
          }}
          onCreateNew={(name) => {
            setSelectedCompany(null);
            setNewCompanyName(name);
          }}
          placeholder={initialCompanyName ?? "Selecionar empresa..."}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-contact">
          Contato
        </label>
        <Combobox<PartyOption>
          items={contactOptions}
          getLabel={(item) => item.label}
          getValue={(item) => item.id}
          value={selectedContact?.id ?? null}
          onSelect={(item) => {
            setSelectedContact(item);
            setNewContactName(null);
          }}
          onCreateNew={(name) => {
            setSelectedContact(null);
            setNewContactName(name);
          }}
          placeholder={initialContactName ?? "Selecionar contato..."}
        />
      </div>

      <Button onClick={handleConfirm}>Confirmar</Button>
    </div>
  );
}
```

The `role="combobox"` accessible name for each Combobox instance comes from the existing
`Combobox` primitive's trigger `Button` (`role="combobox"`, from the Inbox Design System
Additions plan) — its accessible name is derived from its visible text content (the
`placeholder` when nothing is selected), so passing a distinct `placeholder` per instance
(`initialCompanyName ?? "Selecionar empresa..."` vs `initialContactName ?? "Selecionar
contato..."`) is what makes `getByRole("combobox", {name: /empresa/i})` resolve to the right
one in the test — no extra `aria-label` prop needs to be threaded through.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/inbox/inquiry-edit-form.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing test extending `InquirySidePanel`**

Read the current content of `src/components/inbox/inquiry-side-panel.test.tsx` (Task 7) in
full first. Add this test to the existing `describe("InquirySidePanel", ...)` block:

```typescript
it("falls back to the edit form automatically when convert returns 422, and confirming it retries with the resolved company", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes("/convert") && init) {
      const body = JSON.parse(init.body as string);
      if (body.companyId === "c1") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ inquiry: {}, lead: {}, opportunity: {} }) });
      }
      return Promise.resolve({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({ error: "Multiple companies match" }),
      });
    }
    if (url.includes("/api/companies")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ id: "c1", organizationId: "org1", name: "Bella Cosméticos Ltda", createdAt: "2026-01-01" }],
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => [] });
  });
  vi.stubGlobal("fetch", fetchMock);

  renderPanel();

  await user.click(screen.getByRole("button", { name: "Converter em Opportunity" }));
  expect(await screen.findByText(/Mais de uma empresa encontrada/)).toBeInTheDocument();

  const companyCombobox = await screen.findByRole("combobox", { name: /empresa/i });
  await user.click(companyCombobox);
  await user.click(await screen.findByText("Bella Cosméticos Ltda"));
  await user.click(screen.getByRole("button", { name: "Confirmar" }));

  expect(await screen.findByText("Convertida em Opportunity")).toBeInTheDocument();
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/components/inbox/inquiry-side-panel.test.tsx`
Expected: FAIL — the panel doesn't render `InquiryEditForm` yet on a 422.

- [ ] **Step 7: Wire edit mode into `InquirySidePanel`**

Read the current full content of `src/components/inbox/inquiry-side-panel.tsx` (Task 7)
before editing.

```typescript
// src/components/inbox/inquiry-side-panel.tsx
// Add this import:
import { InquiryEditForm } from "./inquiry-edit-form";

// Add state, inside InquirySidePanel (after the mutation hook calls):
  const [editMode, setEditMode] = React.useState(false);

// Reset edit mode whenever a different inquiry is opened -- add this
// effect (import React's useEffect alongside useState):
  React.useEffect(() => {
    setEditMode(false);
  }, [inquiry?.id]);

// Update handleConvert's onError branch for the 422 case:
        onError: (error) => {
          if (error instanceof ApiError && error.status === 422) {
            toast.error("Mais de uma empresa encontrada com esse nome — selecione a correta.");
            setEditMode(true);
            return;
          }
          toast.error(error.message);
        },

// Add a handler for the edit form's confirm, alongside the other handlers:
  function handleEditConfirm(input: { contact: { id: string } | { fullName: string }; companyId?: string | null }) {
    convert.mutate(
      { inquiryId: inquiry!.id, contact: input.contact, companyId: input.companyId },
      {
        onSuccess: () => {
          toast.success("Convertida em Opportunity");
          setEditMode(false);
          onOpenChange(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

// Replace the action-buttons block's JSX with a conditional: the 1-click
// row when !editMode, the InquiryEditForm when editMode:
        {editMode ? (
          <InquiryEditForm
            organizationId={organizationId}
            initialCompanyName={inquiry.companyGuess}
            initialContactName={inquiry.contactNameGuess}
            onConfirm={handleEditConfirm}
          />
        ) : (
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={handleConvert} disabled={convert.isPending}>
              Converter em Opportunity
            </Button>
            <Button variant="outline" onClick={handleDiscard} disabled={discard.isPending}>
              Descartar
            </Button>
            <Button
              variant="ghost"
              onClick={handleMarkFalsePositive}
              disabled={markFalsePositive.isPending}
            >
              Falso Positivo
            </Button>
          </div>
        )}
```

Add `import * as React from "react";` if the file doesn't already import it (it currently
doesn't need `React` directly since it has no hooks of its own before this task — check the
current top-of-file imports and add it if missing).

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/components/inbox/inquiry-side-panel.test.tsx`
Expected: PASS (all tests in this file, including the new one)

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/inbox/inquiry-edit-form.tsx src/components/inbox/inquiry-edit-form.test.tsx src/components/inbox/inquiry-side-panel.tsx src/components/inbox/inquiry-side-panel.test.tsx
git commit -m "feat: add edit-mode Combobox flow with automatic 422 fallback"
```

---

### Task 9: New Message Sheet

**Files:**
- Create: `src/components/inbox/new-message-sheet.tsx`
- Modify: `src/app/inbox/page.tsx`
- Test: `src/components/inbox/new-message-sheet.test.tsx`

**Interfaces:**
- Consumes: `useSendInboxMessage`/`SendMessageInput` (Task 5), `Sheet`/`SheetContent`/
  `SheetTitle` (existing), `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`
  (Inbox Design System Additions plan), `Input`/`Textarea`/`Button` (existing/Inbox Design
  System Additions plan).
- Produces: `NewMessageSheet` from `src/components/inbox/new-message-sheet.tsx` — props
  `{open: boolean, onOpenChange: (open: boolean) => void, organizationId: string, creatorId:
  string, onSent: () => void}`. `creatorId` comes from the Creator Switcher (already selected,
  displayed as read-only text, not an editable field — per the approved spec). On successful
  send, calls `onSent()` (the page invalidates the "NEW" tab's query and closes the sheet) and
  shows a toast.

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/inbox/new-message-sheet.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { NewMessageSheet } from "./new-message-sheet";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NewMessageSheet", () => {
  it("submits the form and calls onSent on success", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSent = vi.fn();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <NewMessageSheet
          open
          onOpenChange={() => {}}
          organizationId="org1"
          creatorId="creator1"
          onSent={onSent}
        />
        <Toaster />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText("Remetente"), "Maria — Bella Cosméticos");
    await user.type(screen.getByLabelText("Mensagem"), "Olá, gostaríamos de saber os valores.");

    const channelSelect = screen.getByRole("combobox", { name: "Canal" });
    await user.click(channelSelect);
    await user.click(await screen.findByRole("option", { name: "WhatsApp" }));

    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await vi.waitFor(() => expect(onSent).toHaveBeenCalled());

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      organizationId: "org1",
      creatorId: "creator1",
      source: "WHATSAPP",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores.",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/inbox/new-message-sheet.test.tsx`
Expected: FAIL — `./new-message-sheet` doesn't exist.

- [ ] **Step 3: Implement `NewMessageSheet`**

```typescript
// src/components/inbox/new-message-sheet.tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSendInboxMessage } from "@/hooks/use-send-inbox-message";

export interface NewMessageSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  creatorId: string;
  onSent: () => void;
}

const CHANNEL_LABELS = {
  INSTAGRAM: "Instagram",
  WHATSAPP: "WhatsApp",
  TIKTOK: "TikTok",
} as const;

export function NewMessageSheet({
  open,
  onOpenChange,
  organizationId,
  creatorId,
  onSent,
}: NewMessageSheetProps) {
  const [source, setSource] = React.useState<"INSTAGRAM" | "WHATSAPP" | "TIKTOK">("INSTAGRAM");
  const [externalContactLabel, setExternalContactLabel] = React.useState("");
  const [body, setBody] = React.useState("");
  const sendMessage = useSendInboxMessage();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    sendMessage.mutate(
      { organizationId, creatorId, source, externalContactLabel, body },
      {
        onSuccess: () => {
          toast.success("Mensagem enviada");
          setExternalContactLabel("");
          setBody("");
          setSource("INSTAGRAM");
          onSent();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Nova Mensagem</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="new-message-channel">
              Canal
            </label>
            <Select value={source} onValueChange={(value) => setSource(value as typeof source)}>
              <SelectTrigger id="new-message-channel" aria-label="Canal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="new-message-sender">
              Remetente
            </label>
            <Input
              id="new-message-sender"
              value={externalContactLabel}
              onChange={(event) => setExternalContactLabel(event.target.value)}
              placeholder="Maria — Bella Cosméticos"
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="new-message-body">
              Mensagem
            </label>
            <Textarea
              id="new-message-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Cole ou digite a mensagem recebida..."
              required
            />
          </div>

          <Button type="submit" disabled={sendMessage.isPending}>
            Enviar
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/inbox/new-message-sheet.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the New Message button and Sheet into the page**

Read the current full content of `src/app/inbox/page.tsx` (Task 7) before editing.

```typescript
// src/app/inbox/page.tsx
// Add these imports:
import { Button } from "@/components/ui/button";
import { NewMessageSheet } from "@/components/inbox/new-message-sheet";
import { useQueryClient } from "@tanstack/react-query";
import { commercialInquiriesQueryKey } from "@/hooks/use-commercial-inquiries";

// Add state, inside InboxPage:
  const [newMessageOpen, setNewMessageOpen] = React.useState(false);
  const queryClient = useQueryClient();

// Replace the header row (currently just the <h1>) to add the button:
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inbox</h1>
        <Button onClick={() => setNewMessageOpen(true)}>Nova Mensagem</Button>
      </div>

// Also pass an action to the "Novas" empty state (only there, per the
// spec's Decisão #12), replacing the earlier plain EmptyState call for
// that case:
        <EmptyState
          icon={InboxIcon}
          title={activeTab === "NEW" ? "Nenhuma mensagem nova" : "Nada por aqui"}
          description={
            activeTab === "NEW" ? "Novas mensagens comerciais aparecem aqui." : undefined
          }
          action={
            activeTab === "NEW" ? (
              <Button onClick={() => setNewMessageOpen(true)}>Nova Mensagem</Button>
            ) : undefined
          }
        />

// Add the Sheet as a sibling of InquirySidePanel, at the end of the
// returned JSX:
      <NewMessageSheet
        open={newMessageOpen}
        onOpenChange={setNewMessageOpen}
        organizationId={organizationId}
        creatorId={selectedCreatorId}
        onSent={() => {
          setNewMessageOpen(false);
          queryClient.invalidateQueries({
            queryKey: commercialInquiriesQueryKey(organizationId, selectedCreatorId, "NEW"),
          });
        }}
      />
```

- [ ] **Step 6: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/inbox/new-message-sheet.tsx src/components/inbox/new-message-sheet.test.tsx src/app/inbox/page.tsx
git commit -m "feat: add New Message Sheet"
```

---

### Task 10: Keyboard shortcuts

**Files:**
- Create: `src/components/inbox/use-inbox-shortcuts.ts`
- Modify: `src/app/inbox/page.tsx`
- Test: `src/components/inbox/use-inbox-shortcuts.test.ts`

**Interfaces:**
- Produces: `useInboxShortcuts(options: {inquiries: CommercialInquiryListItem[], selectedId:
  string | null, onSelect: (inquiry: CommercialInquiryListItem) => void, onConvert: () =>
  void, onDiscard: () => void, onMarkFalsePositive: () => void, onClose: () => void}): void`
  from `src/components/inbox/use-inbox-shortcuts.ts`. Registers a `document`-level `keydown`
  listener (cleaned up on unmount). `j`/`k` move the selection to the next/previous inquiry in
  the current list (wrapping is NOT required — stop at the ends); `C`/`D`/`F` call
  `onConvert`/`onDiscard`/`onMarkFalsePositive` when an inquiry is selected; `Escape` calls
  `onClose`. Every shortcut except `Escape` is suppressed when
  `document.activeElement` is an `INPUT`, `TEXTAREA`, or `SELECT` element, or has
  `role="combobox"`/is inside `[cmdk-input]` — the exact guard the approved spec requires,
  since the New Message form and the edit-mode Combobox both have text fields where these
  letters are typed normally. `Escape` is NOT suppressed by the same guard (closing the panel
  while a field inside it has focus is still the expected behavior).

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/inbox/use-inbox-shortcuts.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import { useInboxShortcuts } from "./use-inbox-shortcuts";

function makeInquiry(id: string): CommercialInquiryListItem {
  return {
    id,
    organizationId: "org1",
    creatorId: "creator1",
    messageId: `m-${id}`,
    status: "NEW",
    companyGuess: null,
    brandGuess: null,
    contactNameGuess: null,
    budgetGuess: null,
    intentGuess: null,
    convertedLeadId: null,
    linkedOpportunityId: null,
    createdAt: "2026-01-01T12:00:00.000Z",
    messageBody: "msg",
    messageReceivedAt: "2026-01-01T12:00:00.000Z",
    externalContactLabel: `Contact ${id}`,
    source: "INSTAGRAM",
    conversationId: `conv-${id}`,
  };
}

const inquiries = [makeInquiry("i1"), makeInquiry("i2"), makeInquiry("i3")];

describe("useInboxShortcuts", () => {
  it("moves selection down/up with j/k and fires actions with C/D/F", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onConvert = vi.fn();
    const onDiscard = vi.fn();
    const onMarkFalsePositive = vi.fn();
    const onClose = vi.fn();

    renderHook(() =>
      useInboxShortcuts({
        inquiries,
        selectedId: "i1",
        onSelect,
        onConvert,
        onDiscard,
        onMarkFalsePositive,
        onClose,
      }),
    );

    await user.keyboard("j");
    expect(onSelect).toHaveBeenCalledWith(inquiries[1]);

    await user.keyboard("c");
    expect(onConvert).toHaveBeenCalledTimes(1);

    await user.keyboard("d");
    expect(onDiscard).toHaveBeenCalledTimes(1);

    await user.keyboard("f");
    expect(onMarkFalsePositive).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not fire C/D/F/j/k while focus is inside an input, but still handles Escape", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onConvert = vi.fn();
    const onClose = vi.fn();

    document.body.innerHTML = '<input id="probe" />';
    const input = document.getElementById("probe")!;
    input.focus();

    renderHook(() =>
      useInboxShortcuts({
        inquiries,
        selectedId: "i1",
        onSelect,
        onConvert,
        onDiscard: vi.fn(),
        onMarkFalsePositive: vi.fn(),
        onClose,
      }),
    );

    await user.keyboard("c");
    expect(onConvert).not.toHaveBeenCalled();

    await user.keyboard("j");
    expect(onSelect).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/inbox/use-inbox-shortcuts.test.ts`
Expected: FAIL — `./use-inbox-shortcuts` doesn't exist.

- [ ] **Step 3: Implement `useInboxShortcuts`**

```typescript
// src/components/inbox/use-inbox-shortcuts.ts
import * as React from "react";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";

export interface UseInboxShortcutsOptions {
  inquiries: CommercialInquiryListItem[];
  selectedId: string | null;
  onSelect: (inquiry: CommercialInquiryListItem) => void;
  onConvert: () => void;
  onDiscard: () => void;
  onMarkFalsePositive: () => void;
  onClose: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.getAttribute("role") === "combobox") return true;
  if (target.closest("[cmdk-input]")) return true;
  return false;
}

export function useInboxShortcuts({
  inquiries,
  selectedId,
  onSelect,
  onConvert,
  onDiscard,
  onMarkFalsePositive,
  onClose,
}: UseInboxShortcutsOptions): void {
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();

      if (key === "j" || key === "k") {
        const currentIndex = inquiries.findIndex((inquiry) => inquiry.id === selectedId);
        const nextIndex = key === "j" ? currentIndex + 1 : currentIndex - 1;
        const next = inquiries[nextIndex];
        if (next) onSelect(next);
        return;
      }

      if (!selectedId) return;

      if (key === "c") onConvert();
      if (key === "d") onDiscard();
      if (key === "f") onMarkFalsePositive();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [inquiries, selectedId, onSelect, onConvert, onDiscard, onMarkFalsePositive, onClose]);
}
```

Note the `j`/`k`/`C`/`D`/`F` shortcuts don't require a `selectedId` to navigate (`j`/`k` select
the first item via `currentIndex` starting at `-1` when nothing is selected, since
`findIndex` returns `-1` for no match and `-1 + 1 === 0`), but `C`/`D`/`F` DO require a
`selectedId` (the early `if (!selectedId) return;` guard) — there's nothing to act on
otherwise.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/inbox/use-inbox-shortcuts.test.ts`
Expected: PASS (both cases)

- [ ] **Step 5: Wire the shortcuts hook into the page**

Read the current full content of `src/app/inbox/page.tsx` (Task 9) before editing.

```typescript
// src/app/inbox/page.tsx
// Add this import:
import { useInboxShortcuts } from "@/components/inbox/use-inbox-shortcuts";

// Add this hook call inside InboxPage, after the existing state/query
// hooks (it needs `inquiries`, `selectedInquiry`, and the panel's action
// handlers -- but those handlers live inside InquirySidePanel today, not
// the page. Expose them via refs the panel calls into, OR -- simpler and
// consistent with this plan's "no premature abstraction" thread -- have
// the page own a `sidePanelActionsRef` that InquirySidePanel populates.
// Use this simpler approach: pass a `registerActions` callback prop to
// InquirySidePanel that hands the page its convert/discard/markFalsePositive
// handlers once, so the page's shortcut hook can call them.):
  const sidePanelActionsRef = React.useRef<{
    convert: () => void;
    discard: () => void;
    markFalsePositive: () => void;
  } | null>(null);

  useInboxShortcuts({
    inquiries: inquiries ?? [],
    selectedId: selectedInquiry?.id ?? null,
    onSelect: setSelectedInquiry,
    onConvert: () => sidePanelActionsRef.current?.convert(),
    onDiscard: () => sidePanelActionsRef.current?.discard(),
    onMarkFalsePositive: () => sidePanelActionsRef.current?.markFalsePositive(),
    onClose: () => setSelectedInquiry(null),
  });

// Pass the ref-setter to InquirySidePanel:
      <InquirySidePanel
        inquiry={selectedInquiry}
        open={selectedInquiry !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedInquiry(null);
        }}
        organizationId={organizationId}
        creatorId={selectedCreatorId}
        status={activeTab}
        registerActions={(actions) => {
          sidePanelActionsRef.current = actions;
        }}
      />
```

Read the current full content of `src/components/inbox/inquiry-side-panel.tsx` (Task 8)
before editing it too.

```typescript
// src/components/inbox/inquiry-side-panel.tsx
// Add to InquirySidePanelProps:
  registerActions?: (actions: {
    convert: () => void;
    discard: () => void;
    markFalsePositive: () => void;
  }) => void;

// Add to the component's props destructuring:
  registerActions,

// Add an effect, after the existing editMode-reset effect, that hands the
// three 1-click handlers (already defined in this file) to the page each
// time the selected inquiry changes -- so the shortcut hook always calls
// the CURRENT inquiry's handlers, not stale ones from a previous selection:
  React.useEffect(() => {
    registerActions?.({
      convert: handleConvert,
      discard: handleDiscard,
      markFalsePositive: handleMarkFalsePositive,
    });
  }, [inquiry?.id]);
```

The `useEffect`'s dependency array intentionally lists only `inquiry?.id` (not
`handleConvert`/`handleDiscard`/`handleMarkFalsePositive`, which are re-created every render as
plain function declarations, not `useCallback`-memoized) — re-registering on every render
would be harmless but wasteful; re-registering whenever the selected inquiry changes is
sufficient since that's the only thing that actually changes which inquiry the handlers act on.

- [ ] **Step 6: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/inbox/use-inbox-shortcuts.ts src/components/inbox/use-inbox-shortcuts.test.ts src/components/inbox/inquiry-side-panel.tsx src/app/inbox/page.tsx
git commit -m "feat: add Inbox keyboard shortcuts (j/k/C/D/F/Esc) with focus guard"
```

---

## Self-Review

**Spec coverage:**
- Decisões #1–#3 (layout, tabs, list columns) — Task 6.
- Decisões #4–#5 (Side Panel content, actions) — Task 7.
- Decisão #6–#7 (1-click convert, safe backend resolution already in place, 422 → automatic
  edit-mode fallback with the exact required message) — Tasks 7–8.
- Decisão #8 (edit mode Combobox, create-new) — Task 8.
- Decisão #9 (post-action: row leaves list via query invalidation + refetch, panel closes,
  toast) — Tasks 4 (invalidation) and 7 (toast + close).
- Decisão #10 (Nova Mensagem Sheet) — Task 9.
- Decisão #11 (keyboard shortcuts + focus guard) — Task 10.
- Decisão #12 (Empty State, with CTA only on the "Novas" tab) — Tasks 6 and 9.
- §3's five new components (Toast, Empty State, Combobox, Select, Textarea) — all consumed
  from the separate, already-merged Inbox Design System Additions plan; none re-implemented
  here.
- Global Constraints' exact API contracts — Tasks 3–5's hooks match every field/status/body
  shape listed, verified against the actually-merged route code, not assumed.

**Placeholder scan:** none — every step has literal, complete code.

**Type consistency:** `CommercialInquiryListItem` (Task 3) is imported by name — never
redefined — in Tasks 6, 7, 8, 10. `InquiryStatus` (Task 3) is reused identically in Tasks 4, 6,
7. `PartyOption` (Task 5) is reused identically in Task 8. `ConvertInput`'s `contact` shape
(Task 4) matches exactly what `InquiryEditForm.onConfirm` (Task 8) and
`InquirySidePanel.handleConvert`/`handleEditConfirm` (Tasks 7–8) construct and pass through.
`commercialInquiriesQueryKey` (Task 3) is the single source of truth for the query key shape,
used identically by Task 4's three mutations' invalidation calls and Task 9's post-send
invalidation — no key shape is duplicated or drifts.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-inbox-screen.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
