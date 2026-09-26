"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relativeTime, formatCurrencyBRL } from "@/lib/format";
import { STAGES, STAGE_LABELS, type OpportunityStage } from "@/lib/opportunity-stages";
import { useProposals, useCreateProposal } from "@/hooks/use-proposals";
import { PROPOSAL_THEMES, PROPOSAL_THEME_LABELS, type ProposalTheme } from "@/lib/proposal-themes";
import { ProposalStatusBadge } from "@/components/proposals/proposal-status-badge";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

export interface OpportunitySidePanelProps {
  opportunity: OpportunityListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void;
}

export function OpportunitySidePanel({
  opportunity,
  open,
  onOpenChange,
  onMoveToStage,
}: OpportunitySidePanelProps) {
  const router = useRouter();
  const opportunityId = opportunity?.id ?? "";

  const { data: proposals } = useProposals(opportunityId, {
    enabled: opportunity !== null,
  });
  const createProposal = useCreateProposal();

  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [theme, setTheme] = React.useState<ProposalTheme | "">("");

  function handleCreate() {
    if (!title.trim() || !theme) return;
    createProposal.mutate(
      { opportunityId, title: title.trim(), theme },
      {
        onSuccess: (proposal) => {
          setCreateDialogOpen(false);
          setTitle("");
          setTheme("");
          router.push(`/proposals/${proposal.id}`);
        },
      },
    );
  }

  if (!opportunity) return null;

  const label = opportunity.brandName ?? opportunity.companyName ?? opportunity.contactName;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{label}</SheetTitle>
          <SheetDescription>{relativeTime(opportunity.createdAt)}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">Contato: </span>
            {opportunity.contactName}
          </p>
          {opportunity.companyName && opportunity.companyName !== label ? (
            <p>
              <span className="text-muted-foreground">Empresa: </span>
              {opportunity.companyName}
            </p>
          ) : null}
          {opportunity.brandName ? (
            <p>
              <span className="text-muted-foreground">Marca: </span>
              {opportunity.brandName}
            </p>
          ) : null}
          {opportunity.estimatedValueCents !== null ? (
            <p>
              <span className="text-muted-foreground">Valor estimado: </span>
              {formatCurrencyBRL(opportunity.estimatedValueCents)}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="opportunity-stage">
            Stage
          </label>
          <Select
            value={opportunity.stage}
            onValueChange={(value) => onMoveToStage(opportunity.id, value as OpportunityStage)}
          >
            <SelectTrigger id="opportunity-stage" aria-label="Stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((stage) => (
                <SelectItem key={stage} value={stage}>
                  {STAGE_LABELS[stage]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Propostas</span>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Nova Proposta
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nova Proposta</DialogTitle>
                  <DialogDescription>Título e tema podem ser ajustados depois.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="new-proposal-title">
                      Título
                    </label>
                    <Input
                      id="new-proposal-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Ex: Campanha Verão"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="new-proposal-theme">
                      Tema
                    </label>
                    <Select value={theme} onValueChange={(value) => setTheme(value as ProposalTheme)}>
                      <SelectTrigger id="new-proposal-theme" aria-label="Tema">
                        <SelectValue placeholder="Selecionar tema" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROPOSAL_THEMES.map((item) => (
                          <SelectItem key={item} value={item}>
                            {PROPOSAL_THEME_LABELS[item]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button onClick={handleCreate} disabled={!title.trim() || !theme || createProposal.isPending}>
                    Criar
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {proposals && proposals.length > 0 ? (
            <div className="flex flex-col gap-1">
              {proposals.map((proposal) => (
                <button
                  key={proposal.id}
                  onClick={() => router.push(`/proposals/${proposal.id}`)}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span>{proposal.title}</span>
                  <ProposalStatusBadge status={proposal.status} />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma proposta ainda.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
