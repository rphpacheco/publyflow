# Mark False Positive Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose `CommercialInquiryService.markFalsePositive` over HTTP as
`POST /api/commercial-inquiries/[id]/mark-false-positive`, with correct domain-error-to-HTTP
mapping, so the Inbox UX can offer "Falso Positivo" as a distinct action from "Descartar".

**Architecture:** A single new Next.js route handler calling the existing, unmodified
`CommercialInquiryService.markFalsePositive`. Error mapping follows the `instanceof`-based
pattern already used by `src/app/api/opportunities/[id]/route.ts`'s `PATCH` handler — not
`discard`'s route, which has a known, separately-registered gap (no error mapping at all).

**Tech Stack:** Next.js 16 (Route Handlers), Zod, Vitest.

## Global Constraints

- Request body: `{organizationId: string (uuid)}`. Success response: `204`, no body.
- `InquiryNotFoundError` → `404` with `{error: message}`. `InquiryAlreadyResolvedError` → `409`
  with `{error: message}`. Both errors already exist in `src/domain/commercial-flow/errors.ts`
  — no new error class needed.
- No changes to `discard`'s or `convert`'s routes, and no change to
  `CommercialInquiryService.markFalsePositive` itself (it already does everything this route
  needs).
- No UI in this plan.

---

### Task 1: `POST /api/commercial-inquiries/[id]/mark-false-positive`

**Files:**
- Create: `src/app/api/commercial-inquiries/[id]/mark-false-positive/route.ts`
- Test: `src/app/api/commercial-inquiries/[id]/mark-false-positive/route.test.ts`

**Interfaces:**
- Consumes: `CommercialInquiryService.markFalsePositive(db, organizationId, inquiryId): Promise<void>`
  (unchanged, already implemented in `src/services/commercial-inquiry.service.ts`), throws
  `InquiryNotFoundError` or `InquiryAlreadyResolvedError` (both from
  `src/domain/commercial-flow/errors.ts`).
- Produces: `POST /api/commercial-inquiries/:id/mark-false-positive` with body
  `{organizationId}` → `204` on success, `404` if the inquiry doesn't resolve for that
  organization, `409` if the inquiry is already in a terminal status.

- [ ] **Step 1: Write the failing route test**

```typescript
// src/app/api/commercial-inquiries/[id]/mark-false-positive/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { InboxService } from "@/services/inbox.service";

function fakeAI() {
  return {
    classifyMessage: async () => ({
      category: "COMMERCIAL_LEAD" as const,
      commercialScore: 90,
      intent: "Pedido de mídia kit",
      extracted: {
        companyName: "Bella Cosméticos",
        brandName: null,
        contactName: "Maria",
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    }),
  };
}

async function setupOrgCreatorAndInquiry(db: Awaited<ReturnType<typeof withTestDb>>["db"]) {
  const { organization } = await OrganizationService.createWithOwner(db, {
    organizationName: "Org",
    ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const creator = await CreatorService.onboardCreator(db, organization.id, {
    email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
    fullName: "Thais",
    displayName: "Thais",
  });
  const { inquiry } = await InboxService.ingestManualMessage(db, fakeAI(), organization.id, {
    creatorId: creator.id,
    source: "INSTAGRAM",
    externalContactLabel: "Maria — Bella Cosméticos",
    body: "Olá, gostaríamos de saber os valores.",
    receivedAt: new Date(),
  });
  return { organization, creator, inquiry: inquiry! };
}

describe("POST /api/commercial-inquiries/:id/mark-false-positive", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 204 and marks the inquiry as FALSE_POSITIVE", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.doMock("@/db", () => ({ db }));

    const { organization, inquiry } = await setupOrgCreatorAndInquiry(db);

    const { POST } = await import("./route");
    const request = new Request(
      `http://localhost/api/commercial-inquiries/${inquiry.id}/mark-false-positive`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      },
    );

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(204);

    const { CommercialInquiriesRepository } = await import(
      "@/repositories/commercial-inquiries.repository"
    );
    const updated = await CommercialInquiriesRepository.findById(db, organization.id, inquiry.id);
    expect(updated?.status).toBe("FALSE_POSITIVE");
  });

  it("returns 404 when the inquiry does not exist for that organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.doMock("@/db", () => ({ db }));

    const { organization } = await setupOrgCreatorAndInquiry(db);

    const { POST } = await import("./route");
    const nonexistentId = "00000000-0000-0000-0000-000000000000";
    const request = new Request(
      `http://localhost/api/commercial-inquiries/${nonexistentId}/mark-false-positive`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      },
    );

    const response = await POST(request, { params: Promise.resolve({ id: nonexistentId }) });
    expect(response.status).toBe(404);
  });

  it("returns 409 when the inquiry is already in a terminal status", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.doMock("@/db", () => ({ db }));

    const { organization, inquiry } = await setupOrgCreatorAndInquiry(db);

    const { CommercialInquiryService } = await import("@/services/commercial-inquiry.service");
    await CommercialInquiryService.discard(db, organization.id, inquiry.id);

    const { POST } = await import("./route");
    const request = new Request(
      `http://localhost/api/commercial-inquiries/${inquiry.id}/mark-false-positive`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      },
    );

    const response = await POST(request, { params: Promise.resolve({ id: inquiry.id }) });
    expect(response.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run "src/app/api/commercial-inquiries/[id]/mark-false-positive/route.test.ts"`
Expected: FAIL — `./route` doesn't exist.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/commercial-inquiries/[id]/mark-false-positive/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import { InquiryNotFoundError, InquiryAlreadyResolvedError } from "@/domain/commercial-flow/errors";

const bodySchema = z.object({ organizationId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = bodySchema.parse(await request.json());

  try {
    await CommercialInquiryService.markFalsePositive(db, payload.organizationId, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof InquiryNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof InquiryAlreadyResolvedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run "src/app/api/commercial-inquiries/[id]/mark-false-positive/route.test.ts"`
Expected: PASS (all 3 cases: 204, 404, 409).

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add "src/app/api/commercial-inquiries/[id]/mark-false-positive"
git commit -m "feat: add POST /api/commercial-inquiries/:id/mark-false-positive"
```

---

## Self-Review

**Spec coverage:**
- §2 (route shape, error mapping distinct from `discard`'s gap) — Task 1's implementation and
  its three test cases (204/404/409).
- §3 (no changes to `discard`/`convert`/the service itself) — no task touches any of those
  files; confirmed by the "Files" list containing only new files.
- §1's "no UI" — correctly absent.

**Placeholder scan:** none — the route and test are both complete, runnable code.

**Type consistency:** `CommercialInquiryService.markFalsePositive(db, organizationId, inquiryId): Promise<void>`
is used with the exact existing signature (verified against
`src/services/commercial-inquiry.service.ts`); `InquiryNotFoundError`/`InquiryAlreadyResolvedError`
are imported from their existing location, not redefined.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-mark-false-positive-route.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
