"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useProposal } from "@/hooks/use-proposal";
import { useProposalSendState } from "@/hooks/use-proposal-sending";
import { ProposalStatusBadge } from "@/components/proposals/proposal-status-badge";
import { ProposalSendHistory } from "@/components/proposals/proposal-send-history";
import { ProposalShareActions } from "@/components/proposals/proposal-share-actions";

/** What a CREATOR sees instead of the editor: presentation, status, history, sharing. */
export function ProposalReadView({ proposalId }: { proposalId: string }) {
  const { data: proposal } = useProposal(proposalId);
  const { data: state } = useProposalSendState(proposalId);
  if (!proposal) return null;

  async function copyLink(publicPath: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">{proposal.title}</h1>
        <ProposalStatusBadge status={proposal.status} />
      </div>
      {state?.publicPath ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => copyLink(state.publicPath!)}>
            Copiar link
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={state.publicPath} target="_blank" rel="noopener noreferrer">
              Abrir
            </a>
          </Button>
          <ProposalShareActions proposalId={proposalId} publicPath={state.publicPath} />
        </div>
      ) : null}
      <iframe
        title="Apresentação da proposta"
        src={`/proposals/${proposalId}/preview`}
        className="h-[70vh] w-full rounded-lg border border-border bg-card"
      />
      <ProposalSendHistory proposalId={proposalId} status={proposal.status} />
    </div>
  );
}
