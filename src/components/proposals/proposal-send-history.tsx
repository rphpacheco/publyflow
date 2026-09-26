"use client";

import { useProposalPublications, type PublicationHistoryItemDto } from "@/hooks/use-proposal-sending";
import { formatDateTime } from "@/lib/presentation/format";

function resultLabel(item: PublicationHistoryItemDto): string {
  const response = item.response;
  if (!response) return "aguardando";
  if (response.action === "REQUEST_CHANGES") return `ajustes: ${response.message ?? ""}`.trim();
  if (response.action === "ACCEPT") return `aceita por ${response.respondentName}`;
  return `recusada por ${response.respondentName}`;
}

/** Immutable audit trail: every publication stays listed. */
export function ProposalSendHistory({ proposalId }: { proposalId: string }) {
  const { data } = useProposalPublications(proposalId);
  if (!data || data.length === 0) return null;

  const sorted = [...data].sort((a, b) => b.publicationNumber - a.publicationNumber);

  return (
    <section aria-label="Histórico de envios" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Histórico de envios</h2>
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {sorted.map((item) => (
          <li key={item.id}>
            Versão {item.versionNumber} · {formatDateTime(new Date(item.publishedAt))} · {resultLabel(item)}
          </li>
        ))}
      </ul>
    </section>
  );
}
