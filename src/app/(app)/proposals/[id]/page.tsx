"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import { useProposal, useUpdateProposal } from "@/hooks/use-proposal";
import { useOpportunity } from "@/hooks/use-opportunity";
import { useProposalBlocks } from "@/hooks/use-proposal-blocks";
import { useProposalItems } from "@/hooks/use-proposal-items";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { PROPOSAL_THEMES, PROPOSAL_THEME_LABELS, type ProposalTheme } from "@/lib/proposal-themes";
import { ProposalCoverSection } from "@/components/proposals/proposal-cover-section";
import { ProposalTextSection } from "@/components/proposals/proposal-text-section";
import { ProposalItemsTable } from "@/components/proposals/proposal-items-table";
import { ProposalStatusBadge } from "@/components/proposals/proposal-status-badge";
import { ProposalSendPanel } from "@/components/proposals/proposal-send-panel";
import { ProposalSendHistory } from "@/components/proposals/proposal-send-history";
import { ProposalReadView } from "@/components/proposals/proposal-read-view";
import { useIsCreator } from "@/components/shell/session-role-context";

export default function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: proposalId } = React.use(params);
  const isCreator = useIsCreator();

  const { data: proposal, isLoading, isError, refetch } = useProposal(proposalId);
  const { data: opportunity } = useOpportunity(proposal?.opportunityId ?? "", {
    enabled: proposal !== undefined,
  });
  const {
    data: blocks,
    isLoading: blocksLoading,
    isError: blocksError,
    refetch: refetchBlocks,
  } = useProposalBlocks(proposalId);
  const {
    data: items,
    isLoading: itemsLoading,
    isError: itemsError,
    refetch: refetchItems,
  } = useProposalItems(proposalId);

  const updateProposal = useUpdateProposal(proposalId);

  const [title, setTitle] = React.useState("");
  React.useEffect(() => {
    if (proposal) setTitle(proposal.title);
  }, [proposal?.title]);

  if (isCreator) {
    return <ProposalReadView proposalId={proposalId} />;
  }

  function handleTitleBlur() {
    if (!proposal || !title.trim() || title.trim() === proposal.title) {
      setTitle(proposal?.title ?? "");
      return;
    }
    updateProposal.mutate({ title: title.trim() });
  }

  function handleThemeChange(value: string) {
    updateProposal.mutate({ theme: value as ProposalTheme });
  }

  function handleArchiveToggle() {
    updateProposal.mutate({
      status: proposal?.status === "ARCHIVED" ? "DRAFT" : "ARCHIVED",
    });
  }

  const anyLoading = isLoading || blocksLoading || itemsLoading;
  const anyError = isError || blocksError || itemsError;

  if (anyLoading) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  if (anyError || !proposal) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">Não foi possível carregar a proposta.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetch();
            refetchBlocks();
            refetchItems();
          }}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  const readOnly = proposal.status === "ARCHIVED";
  const coverBlock = blocks?.find((block) => block.blockType === "COVER") ?? null;
  const textBlock = blocks?.find((block) => block.blockType === "TEXT") ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/pipeline"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Voltar
          </Link>
          <ProposalStatusBadge status={proposal.status} />
        </div>

        {readOnly ? (
          <Button variant="outline" size="sm" onClick={handleArchiveToggle}>
            Desarquivar
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                Arquivar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Arquivar esta proposta?</AlertDialogTitle>
                <AlertDialogDescription>
                  Uma proposta arquivada fica somente leitura. Você pode desarquivar depois para
                  voltar a editar.
                  <br />
                  O link público deixará de funcionar.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button variant="outline">Cancelar</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button onClick={handleArchiveToggle}>Arquivar</Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={handleTitleBlur}
          disabled={readOnly}
          className="text-xl font-semibold"
          aria-label="Título da proposta"
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="proposal-theme">
            Tema
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={proposal.theme} onValueChange={handleThemeChange} disabled={readOnly}>
              <SelectTrigger id="proposal-theme" aria-label="Tema" className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPOSAL_THEMES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {PROPOSAL_THEME_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild variant="outline" size="sm">
              <Link href={`/proposals/${proposalId}/preview`}>
                <Eye className="size-4" aria-hidden="true" />
                Pré-visualizar
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <ProposalSendPanel proposalId={proposalId} />
      <ProposalSendHistory proposalId={proposalId} status={proposal.status} />

      {coverBlock ? (
        <ProposalCoverSection proposalId={proposalId} block={coverBlock} readOnly={readOnly} />
      ) : null}

      {textBlock ? (
        <ProposalTextSection proposalId={proposalId} block={textBlock} readOnly={readOnly} />
      ) : null}

      <ProposalItemsTable
        proposalId={proposalId}
        items={items ?? []}
        creatorId={opportunity?.creatorId ?? null}
        readOnly={readOnly}
      />
    </div>
  );
}
