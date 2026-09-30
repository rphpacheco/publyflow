"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useProposal } from "@/hooks/use-proposal";
import { useProposalSendState } from "@/hooks/use-proposal-sending";
import { ProposalStatusBadge } from "@/components/proposals/proposal-status-badge";
import { ProposalSendHistory } from "@/components/proposals/proposal-send-history";
import { ProposalShareActions } from "@/components/proposals/proposal-share-actions";
import { ProposalApprovalBlock } from "@/components/proposals/proposal-approval-block";

/** What a CREATOR sees instead of the editor: presentation, status, history, sharing. */
export function ProposalReadView({ proposalId }: { proposalId: string }) {
  const { data: proposal, isLoading, isError } = useProposal(proposalId);
  const { data: state } = useProposalSendState(proposalId);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  if (isError || !proposal) {
    return <p className="text-sm text-muted-foreground">Proposta não encontrada.</p>;
  }

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
      {state?.approval?.required ? (
        <ProposalApprovalBlock
          proposalId={proposalId}
          approval={state.approval}
          sentWithoutApproval={
            state.latestPublication?.sentWithoutApproval === true &&
            state.latestPublication.versionNumber === state.approval.current?.versionNumber
          }
        />
      ) : null}
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
        // Cache-busted by the version so the creator always previews the
        // version they're about to approve, never a stale iframe (spec D
        // final review F2).
        src={`/proposals/${proposalId}/preview${state?.latestVersionNumber ? `?v=${state.latestVersionNumber}` : ""}`}
        className="h-[70vh] w-full rounded-lg border border-border bg-card"
      />
      <ProposalSendHistory proposalId={proposalId} status={proposal.status} />
    </div>
  );
}
