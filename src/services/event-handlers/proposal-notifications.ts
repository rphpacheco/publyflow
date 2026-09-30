import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import type { DomainEvent } from "@/repositories/domain-events.repository";
import { NotificationsRepository } from "@/repositories/notifications.repository";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { creators } from "@/db/schema/creators";
import { PROPOSAL_EVENT } from "@/lib/events/proposal-events";

export type EventHandler = (tx: NodePgDatabase<typeof schema>, event: DomainEvent) => Promise<void>;

const COPY: Record<string, { title: string; verb: (title: string) => string }> = {
  [PROPOSAL_EVENT.APPROVED]: { title: "Proposta aceita", verb: (title) => `aceitou "${title}".` },
  [PROPOSAL_EVENT.CHANGES_REQUESTED]: { title: "Ajustes pedidos", verb: (title) => `pediu ajustes em "${title}".` },
  [PROPOSAL_EVENT.REJECTED]: { title: "Proposta recusada", verb: (title) => `recusou "${title}".` },
};

type Audience = "staff" | "creator";

const APPROVAL_COPY: Record<
  string,
  { title: string; body: (p: { proposal_title: string; creator_display_name: string }) => string; audience: Audience }
> = {
  [PROPOSAL_EVENT.APPROVAL_REQUESTED]: { title: "Aprovação pedida", body: (p) => `Revise e aprove "${p.proposal_title}".`, audience: "creator" },
  [PROPOSAL_EVENT.CREATOR_APPROVED]: { title: "Creator aprovou", body: (p) => `${p.creator_display_name} aprovou "${p.proposal_title}".`, audience: "staff" },
  [PROPOSAL_EVENT.CREATOR_CHANGES_REQUESTED]: {
    title: "Creator pediu ajustes",
    body: (p) => `${p.creator_display_name} pediu ajustes em "${p.proposal_title}".`,
    audience: "staff",
  },
  [PROPOSAL_EVENT.SENT_WITHOUT_APPROVAL]: {
    title: "Enviada sem sua aprovação",
    body: (p) => `"${p.proposal_title}" foi enviada ao cliente sem sua aprovação.`,
    audience: "creator",
  },
};

export function notificationCopy(
  event: Pick<DomainEvent, "eventType" | "payload">,
): { kind: string; title: string; body: string; linkPath: string } | null {
  const payload = event.payload as { proposal_id: string; proposal_title: string; respondent_name: string; creator_display_name: string };
  const approvalConfig = APPROVAL_COPY[event.eventType];
  if (approvalConfig) {
    return {
      kind: event.eventType,
      title: approvalConfig.title,
      body: approvalConfig.body(payload),
      linkPath: `/proposals/${payload.proposal_id}`,
    };
  }
  const copy = COPY[event.eventType];
  if (!copy) return null;
  return {
    kind: event.eventType,
    title: copy.title,
    body: `${payload.respondent_name} ${copy.verb(payload.proposal_title)}`,
    linkPath: `/proposals/${payload.proposal_id}`,
  };
}

async function owningCreatorUserId(tx: NodePgDatabase<typeof schema>, event: Pick<DomainEvent, "organizationId" | "payload">): Promise<string | null> {
  const payload = event.payload as { proposal_id: string };
  const creatorId = await ProposalsRepository.creatorIdForProposal(tx, event.organizationId, payload.proposal_id);
  const [owner] = creatorId
    ? await tx
        .select({ userId: creators.userId })
        .from(creators)
        .where(and(eq(creators.id, creatorId), eq(creators.organizationId, event.organizationId)))
    : [];
  return owner?.userId ?? null;
}

const notify: EventHandler = async (tx, event) => {
  const copy = notificationCopy(event);
  if (!copy) return;
  const creatorUserId = await owningCreatorUserId(tx, event);
  await NotificationsRepository.fanOutWithTx(tx, event.organizationId, { sourceEventId: event.id, ...copy }, { creatorUserId });
};

const notifyApproval: EventHandler = async (tx, event) => {
  const copy = notificationCopy(event);
  const config = APPROVAL_COPY[event.eventType];
  if (!copy || !config) return;
  const creatorUserId = await owningCreatorUserId(tx, event);
  await NotificationsRepository.fanOutWithTx(
    tx,
    event.organizationId,
    { sourceEventId: event.id, ...copy },
    { creatorUserId, only: config.audience },
  );
};

export const proposalNotificationHandlers: Record<string, EventHandler> = {
  [PROPOSAL_EVENT.APPROVED]: notify,
  [PROPOSAL_EVENT.CHANGES_REQUESTED]: notify,
  [PROPOSAL_EVENT.REJECTED]: notify,
  [PROPOSAL_EVENT.APPROVAL_REQUESTED]: notifyApproval,
  [PROPOSAL_EVENT.CREATOR_APPROVED]: notifyApproval,
  [PROPOSAL_EVENT.CREATOR_CHANGES_REQUESTED]: notifyApproval,
  [PROPOSAL_EVENT.SENT_WITHOUT_APPROVAL]: notifyApproval,
};
