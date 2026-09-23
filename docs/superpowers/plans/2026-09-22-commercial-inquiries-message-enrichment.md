# Commercial Inquiries Message Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `GET /api/commercial-inquiries` return the original message content
(`messageBody`, `messageReceivedAt`, `externalContactLabel`, `source`, `conversationId`)
alongside the existing AI-guessed fields, so the Inbox UX Spec can be designed against real
data instead of a hypothetical shape.

**Architecture:** `CommercialInquiriesRepository.listByCreator` gains an `INNER JOIN` to
`messages` (via `commercialInquiries.messageId`) and `conversations` (via
`messages.conversationId`), returning a new `CommercialInquiryWithMessage` type. The service
and route layers already pass the list through unmodified, so they need only a type update
(service) or nothing at all (route).

**Tech Stack:** Drizzle ORM, PostgreSQL, Vitest.

## Global Constraints

- Same signature: `listByCreator(db, organizationId, creatorId, status?)` at both repository
  and service layers — no new parameters.
- Same ordering (`createdAt desc`) and same optional `status` filter — unchanged behavior,
  only the returned shape grows.
- `INNER JOIN`, not `LEFT JOIN` — `commercialInquiries.messageId` is `NOT NULL`
  (`references(() => messages.id)`), and `messages.conversationId` is `NOT NULL`
  (`references(() => conversations.id)`), so every inquiry has exactly one message and every
  message has exactly one conversation. An inner join cannot silently drop a row.
- No new route, no new endpoint, no Conversations/Messages CRUD, no detail route — this plan
  only changes the response shape of the existing `GET /api/commercial-inquiries`.
- Returning only the single triggering message (not full conversation history) is a v1 Inbox
  scope decision, not an architectural ceiling — `conversationId` is included specifically so
  a future full-history view doesn't require a contract change.

---

### Task 1: Enrich `listByCreator` with message content

**Files:**
- Modify: `src/repositories/commercial-inquiries.repository.ts`
- Modify: `src/services/commercial-inquiry.service.ts`
- Test: `src/repositories/commercial-inquiries.repository.test.ts`
- Test: `src/app/api/commercial-inquiries/route.test.ts`

**Interfaces:**
- Produces: `CommercialInquiryWithMessage` type from
  `src/repositories/commercial-inquiries.repository.ts` — `CommercialInquiry` (all existing
  fields) plus `messageBody: string`, `messageReceivedAt: Date`, `externalContactLabel: string`,
  `source: "INSTAGRAM" | "WHATSAPP" | "TIKTOK"`, `conversationId: string`.
- Modifies: `CommercialInquiriesRepository.listByCreator(db, organizationId, creatorId, status?): Promise<CommercialInquiryWithMessage[]>`
  — same signature, new return type.
- Modifies: `CommercialInquiryService.listByCreator(db, organizationId, creatorId, status?): Promise<CommercialInquiryWithMessage[]>`
  — same signature, new return type, no logic change (still a pure delegate).

- [ ] **Step 1: Write the failing repository test**

Read the current content of `src/repositories/commercial-inquiries.repository.test.ts` first
— it already has a `setupOrgAndCreator` helper and a full working test
("lists inquiries by creator, ordered by createdAt desc, with an optional status filter")
using `InboxService.ingestManualMessage` to create real inquiries. Extend that SAME test with
the new assertions (do not write a second, separate test) — add these lines right after the
existing `const list = await CommercialInquiriesRepository.listByCreator(...)` /
`expect(list.map((row) => row.id)).toEqual(...)` assertions:

```typescript
// Message enrichment: the row for inquiry1 must carry inquiry1's own
// message content (body + who sent it + channel + timestamps), not
// inquiry2's or some merged/wrong value.
const inquiry1Row = list.find((row) => row.id === inquiry1!.id)!;
expect(inquiry1Row.messageBody).toBe("Olá, gostaríamos de saber os valores.");
expect(inquiry1Row.externalContactLabel).toBe("Maria — Bella Cosméticos");
expect(inquiry1Row.source).toBe("INSTAGRAM");
expect(inquiry1Row.messageReceivedAt).toBeInstanceOf(Date);
expect(typeof inquiry1Row.conversationId).toBe("string");

const inquiry2Row = list.find((row) => row.id === inquiry2!.id)!;
expect(inquiry2Row.messageBody).toBe("Oi, gostaríamos de fechar uma parceria.");
expect(inquiry2Row.externalContactLabel).toBe("João — Outra Marca");
expect(inquiry2Row.source).toBe("WHATSAPP");
expect(inquiry2Row.conversationId).not.toBe(inquiry1Row.conversationId);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/commercial-inquiries.repository.test.ts`
Expected: FAIL — `messageBody`/`externalContactLabel`/`source`/`messageReceivedAt`/
`conversationId` are all `undefined` on the returned rows today.

- [ ] **Step 3: Implement the join**

```typescript
// src/repositories/commercial-inquiries.repository.ts
// Add `messages` and `conversations` to the schema imports at the top of
// the file (alongside the existing `commercialInquiries` import):
import { messages, conversations } from "@/db/schema/conversations-messages";

// Add this type near the existing `CommercialInquiry` type export:
export type CommercialInquiryWithMessage = CommercialInquiry & {
  messageBody: string;
  messageReceivedAt: Date;
  externalContactLabel: string;
  source: "INSTAGRAM" | "WHATSAPP" | "TIKTOK";
  conversationId: string;
};

// Replace the body of `listByCreator`:
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    status?: CommercialInquiry["status"],
  ): Promise<CommercialInquiryWithMessage[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const conditions = [
        eq(commercialInquiries.organizationId, organizationId),
        eq(commercialInquiries.creatorId, creatorId),
      ];
      if (status) {
        conditions.push(eq(commercialInquiries.status, status));
      }

      const rows = await tx
        .select({
          inquiry: commercialInquiries,
          messageBody: messages.body,
          messageReceivedAt: messages.receivedAt,
          externalContactLabel: conversations.externalContactLabel,
          source: conversations.source,
          conversationId: conversations.id,
        })
        .from(commercialInquiries)
        .innerJoin(messages, eq(messages.id, commercialInquiries.messageId))
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(and(...conditions))
        .orderBy(desc(commercialInquiries.createdAt));

      return rows.map((row) => ({
        ...row.inquiry,
        messageBody: row.messageBody,
        messageReceivedAt: row.messageReceivedAt,
        externalContactLabel: row.externalContactLabel,
        source: row.source,
        conversationId: row.conversationId,
      }));
    });
  },
```

Check the file's existing `import { and, desc, eq } from "drizzle-orm";` line — `and`, `desc`,
`eq` are already imported; no change needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/commercial-inquiries.repository.test.ts`
Expected: PASS

- [ ] **Step 5: Update the service layer's return type**

```typescript
// src/services/commercial-inquiry.service.ts
// Add `CommercialInquiryWithMessage` to the existing import line from the repository:
import {
  CommercialInquiriesRepository,
  type CommercialInquiry,
  type CommercialInquiryWithMessage,
} from "@/repositories/commercial-inquiries.repository";

// Update listByCreator's signature (body is unchanged — still a pure delegate):
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    status?: CommercialInquiry["status"],
  ): Promise<CommercialInquiryWithMessage[]> {
    return CommercialInquiriesRepository.listByCreator(db, organizationId, creatorId, status);
  },
```

- [ ] **Step 6: Write the failing route test assertion**

Read the current content of `src/app/api/commercial-inquiries/route.test.ts` first — it
already ingests a real message via `InboxService.ingestManualMessage` and asserts
`json[0].companyGuess`. Add these lines right after that existing assertion:

```typescript
    expect(json[0].messageBody).toBe("Olá, gostaríamos de saber os valores.");
    expect(json[0].externalContactLabel).toBe("Maria — Bella Cosméticos");
    expect(json[0].source).toBe("INSTAGRAM");
    expect(typeof json[0].conversationId).toBe("string");
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/commercial-inquiries/route.test.ts`
Expected: FAIL — the route currently returns rows without these fields (before Steps 3/5's
changes are in place; if you're implementing this plan in order, Steps 3–5 are already done,
so re-run to confirm this now passes instead — see Step 8).

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/commercial-inquiries/route.test.ts`
Expected: PASS — no route code changes were needed; the route already forwards the service's
return value unmodified via `NextResponse.json(list, { status: 200 })`.

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/repositories/commercial-inquiries.repository.ts src/repositories/commercial-inquiries.repository.test.ts src/services/commercial-inquiry.service.ts src/app/api/commercial-inquiries/route.test.ts
git commit -m "feat: enrich GET /api/commercial-inquiries with message content"
```

---

## Self-Review

**Spec coverage:**
- Decisão #1 (join location) — Task 1, Step 3.
- Decisão #2 (exact 5 fields, including `conversationId` for future-proofing) — Task 1's
  `CommercialInquiryWithMessage` type and both test extensions assert all 5.
- Decisão #3 (service type update, no logic change) — Task 1, Step 5.
- Decisão #4 (no route change) — Task 1, Steps 6–8 confirm the route needs no edits.
- Decisão #5 (inner join safety) — encoded directly in Step 3's implementation and explained
  in Global Constraints.
- §3 "fora de escopo" (no generic Messages API, no detail route, no full history) — no task
  introduces any of these.

**Placeholder scan:** none — every step has literal code or an exact, runnable test command.

**Type consistency:** `CommercialInquiryWithMessage` is defined once (repository) and reused
by name (not redefined) in the service's return type. `listByCreator`'s parameter list
(`db, organizationId, creatorId, status?`) is identical at both layers, matching the
Global Constraints.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-commercial-inquiries-message-enrichment.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
