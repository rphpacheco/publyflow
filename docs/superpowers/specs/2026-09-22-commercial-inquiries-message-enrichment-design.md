# PublyFlow — Commercial Inquiries Message Enrichment Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Backend Audit Fix Wave, Creators List API — merged to `main`.
Blocks: Inbox UX Spec (the Inbox is a message-driven screen; it cannot be designed against
data that doesn't exist).

## 1. Contexto

`GET /api/commercial-inquiries` (and `CommercialInquiriesRepository.listByCreator`) returns
raw `CommercialInquiry` rows — AI-derived guesses (`companyGuess`, `brandGuess`,
`contactNameGuess`, `budgetGuess`, `intentGuess`) plus a `messageId` foreign key. It does
**not** return the original message content. There is currently **no read path at all** for
`Conversations`/`Messages` — `ConversationsRepository` and `MessagesRepository` only have
`create`/`createWithTx` (used by `InboxService.ingestManualMessage` to write the inbound
message). An assessora reviewing the Inbox needs to see what the person actually wrote (to
validate the AI's guesses before acting), not just the AI's interpretation of it.

This is a small, isolated mini-cycle — like the Creators List API before it — that unblocks
the Inbox UX Spec.

**Fora de escopo:**
- A generic `Conversations`/`Messages` CRUD or list API. Nothing in the approved UX direction
  (the Inbox is inquiry-driven: the assessora reviews AI-flagged commercial messages, not a
  raw unfiltered inbox of every message including fan mail) calls for browsing conversations
  independent of an inquiry.
- A `GET /api/commercial-inquiries/:id` detail endpoint. The list endpoint will already carry
  everything the Inbox needs per row; no screen has been specified yet that needs a
  standalone detail fetch.
- Full conversation history (multiple messages per conversation). `CommercialInquiry` links to
  exactly one triggering `message`; that's the only message this enrichment surfaces. If a
  future screen needs a full thread, that's a separate, deliberate addition.
- Any change to `InboxService.ingestManualMessage`'s write path — this spec only touches read
  APIs.

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Onde enriquecer | `CommercialInquiriesRepository.listByCreator` joins `messages` (on `commercialInquiries.messageId`) and `conversations` (on `messages.conversationId`), returning a new `CommercialInquiryWithMessage` type instead of the bare `CommercialInquiry` row. |
| 2 | Campos adicionados | `messageBody: string` (message content), `messageReceivedAt: Date` (when the message arrived — distinct from `commercialInquiries.createdAt`, which is when the AI classified it), `externalContactLabel: string` (who sent it, e.g. "Maria — Bella Cosméticos"), `source: "INSTAGRAM" \| "WHATSAPP" \| "TIKTOK"` (channel). |
| 3 | Camada de serviço | `CommercialInquiryService.listByCreator`'s return type updates to match (`CommercialInquiryWithMessage[]`) — it's already a thin wrapper, no logic change needed beyond the type. |
| 4 | API HTTP | `GET /api/commercial-inquiries` response shape gains the four new fields per row. No new route, no new query parameter — this is a response-shape enrichment of an existing endpoint. |
| 5 | Join safety | The join is `INNER JOIN` on both `messages` and `conversations` (not `LEFT JOIN`) — `commercialInquiries.messageId` is `NOT NULL` and references `messages.id` with `onDelete: "cascade"`, and every `message` belongs to exactly one `conversation` (also `NOT NULL`/cascade). A `CommercialInquiry` can never exist without its message and that message's conversation, so an inner join cannot silently drop rows. |

## 3. Escopo de Implementação

- New type `CommercialInquiryWithMessage` in `src/repositories/commercial-inquiries.repository.ts`.
- `CommercialInquiriesRepository.listByCreator` rewritten to join and select the extra fields,
  same signature (`db, organizationId, creatorId, status?`), same ordering
  (`createdAt desc`), same optional status filter.
- `CommercialInquiryService.listByCreator`'s return type updated to match.
- No route file changes needed — `GET /api/commercial-inquiries` already returns whatever the
  service returns unmodified (`NextResponse.json(list)`); the response body gains the new
  fields automatically once the layers below return them.
- Tests: extend the existing repository test (`lists inquiries by creator...`) to assert the
  new fields are present and correct; extend the existing route test to assert the response
  JSON includes them.

## 4. Próximo Passo

Gerar o plano de implementação em fases pequenas e verificáveis via skill `writing-plans`.
Depois de mergeado, seguir para o brainstorming da UX Spec do Inbox.
