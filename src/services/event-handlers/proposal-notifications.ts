import { eq } from "drizzle-orm";
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

export function notificationCopy(
  event: Pick<DomainEvent, "eventType" | "payload">,
): { kind: string; title: string; body: string; linkPath: string } | null {
  const copy = COPY[event.eventType];
  if (!copy) return null;
  const payload = event.payload as { proposal_id: string; proposal_title: string; respondent_name: string };
  return {
    kind: event.eventType,
    title: copy.title,
    body: `${payload.respondent_name} ${copy.verb(payload.proposal_title)}`,
    linkPath: `/proposals/${payload.proposal_id}`,
  };
}

const notify: EventHandler = async (tx, event) => {
  const copy = notificationCopy(event);
  if (!copy) return;
  const payload = event.payload as { proposal_id: string };
  const creatorId = await ProposalsRepository.creatorIdForProposal(tx, event.organizationId, payload.proposal_id);
  const [owner] = creatorId
    ? await tx.select({ userId: creators.userId }).from(creators).where(eq(creators.id, creatorId))
    : [];
  await NotificationsRepository.fanOutWithTx(
    tx,
    event.organizationId,
    { sourceEventId: event.id, ...copy },
    { creatorUserId: owner?.userId ?? null },
  );
};

export const proposalNotificationHandlers: Record<string, EventHandler> = {
  [PROPOSAL_EVENT.APPROVED]: notify,
  [PROPOSAL_EVENT.CHANGES_REQUESTED]: notify,
  [PROPOSAL_EVENT.REJECTED]: notify,
};
