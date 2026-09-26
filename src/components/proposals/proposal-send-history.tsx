"use client";

import { useProposalPublications, type PublicationHistoryItemDto } from "@/hooks/use-proposal-sending";
import { formatDateTime } from "@/lib/presentation/format";
import type { ProposalStatus } from "@/lib/proposal-themes";

function resultLabel(item: PublicationHistoryItemDto, isLatest: boolean, status: ProposalStatus): string {
  const response = item.response;
  if (response) {
    if (response.action === "REQUEST_CHANGES") return `ajustes: ${response.message ?? ""}`.trim();
    if (response.action === "ACCEPT") return `aceita por ${response.respondentName}`;
    return `recusada por ${response.respondentName}`;
  }
  if (!isLatest) return "substituída";
  return status === "SENT" ? "aguardando" : "sem resposta";
}

/** Immutable audit trail: every publication stays listed. */
export function ProposalSendHistory({ proposalId, status }: { proposalId: string; status: ProposalStatus }) {
  const { data } = useProposalPublications(proposalId);
  if (!data || data.length === 0) return null;

  const sorted = [...data].sort((a, b) => b.publicationNumber - a.publicationNumber);
  const highestPublicationNumber = Math.max(...data.map((item) => item.publicationNumber));

  return (
    <section aria-label="Histórico de envios" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Histórico de envios</h2>
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {sorted.map((item) => (
          <li key={item.id}>
            Versão {item.versionNumber} · {formatDateTime(new Date(item.publishedAt))} ·{" "}
            {resultLabel(item, item.publicationNumber === highestPublicationNumber, status)}
          </li>
        ))}
      </ul>
    </section>
  );
}
