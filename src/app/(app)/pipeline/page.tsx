"use client";

import * as React from "react";
import { KanbanSquare } from "lucide-react";
import { useCreatorContext } from "@/components/shell/creator-context";
import { useIsCreator } from "@/components/shell/session-role-context";
import { useOpportunities } from "@/hooks/use-opportunities";
import { useUpdateOpportunityStage } from "@/hooks/use-update-opportunity-stage";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { PipelineBoardDesktop } from "@/components/pipeline/pipeline-board-desktop";
import { PipelineBoardMobile } from "@/components/pipeline/pipeline-board-mobile";
import { OpportunitySidePanel } from "@/components/pipeline/opportunity-side-panel";
import type { OpportunityListItem } from "@/hooks/use-opportunities";
import type { OpportunityStage } from "@/lib/opportunity-stages";

export default function PipelinePage() {
  const { selectedCreatorId } = useCreatorContext();
  const isCreator = useIsCreator();
  const [selectedOpportunityId, setSelectedOpportunityId] = React.useState<string | null>(null);

  const {
    data: opportunities,
    isLoading,
    isError,
    refetch,
  } = useOpportunities(selectedCreatorId ?? "", {
    enabled: selectedCreatorId !== null,
  });
  const updateStage = useUpdateOpportunityStage(selectedCreatorId ?? "");

  function handleSelect(opportunity: OpportunityListItem) {
    setSelectedOpportunityId(opportunity.id);
  }

  function handleMoveToStage(opportunityId: string, stage: OpportunityStage) {
    updateStage.mutate({ opportunityId, stage });
  }

  const selectedOpportunity =
    opportunities?.find((item) => item.id === selectedOpportunityId) ?? null;

  if (!selectedCreatorId) {
    return (
      <EmptyState
        icon={KanbanSquare}
        title="Selecione um creator"
        description="Escolha um creator no seletor do header para ver o Pipeline."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Pipeline</h1>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar as oportunidades.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <PipelineBoardDesktop
              opportunities={opportunities ?? []}
              onSelect={handleSelect}
              onMoveToStage={handleMoveToStage}
              readOnly={isCreator}
            />
          </div>
          <div className="md:hidden">
            <PipelineBoardMobile
              opportunities={opportunities ?? []}
              onSelect={handleSelect}
              onMoveToStage={handleMoveToStage}
              readOnly={isCreator}
            />
          </div>
        </>
      )}

      <OpportunitySidePanel
        opportunity={selectedOpportunity}
        open={selectedOpportunityId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedOpportunityId(null);
        }}
        onMoveToStage={handleMoveToStage}
        readOnly={isCreator}
      />
    </div>
  );
}
