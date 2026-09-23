"use client";

import * as React from "react";
import { KanbanSquare } from "lucide-react";
import { getDevOrganizationId } from "@/lib/organization";
import { useCreatorContext } from "@/components/shell/creator-context";
import { useOpportunities } from "@/hooks/use-opportunities";
import { useUpdateOpportunityStage } from "@/hooks/use-update-opportunity-stage";
import { EmptyState } from "@/components/ui/empty-state";
import { PipelineBoardDesktop } from "@/components/pipeline/pipeline-board-desktop";
import { PipelineBoardMobile } from "@/components/pipeline/pipeline-board-mobile";
import { OpportunitySidePanel } from "@/components/pipeline/opportunity-side-panel";
import type { OpportunityListItem } from "@/hooks/use-opportunities";
import type { OpportunityStage } from "@/lib/opportunity-stages";

export default function PipelinePage() {
  const organizationId = getDevOrganizationId();
  const { selectedCreatorId } = useCreatorContext();
  const [selectedOpportunityId, setSelectedOpportunityId] = React.useState<string | null>(null);

  const { data: opportunities, isLoading } = useOpportunities(
    organizationId,
    selectedCreatorId ?? "",
    { enabled: selectedCreatorId !== null },
  );
  const updateStage = useUpdateOpportunityStage(organizationId, selectedCreatorId ?? "");

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
      ) : (
        <>
          <div className="hidden md:block">
            <PipelineBoardDesktop
              opportunities={opportunities ?? []}
              onSelect={handleSelect}
              onMoveToStage={handleMoveToStage}
            />
          </div>
          <div className="md:hidden">
            <PipelineBoardMobile
              opportunities={opportunities ?? []}
              onSelect={handleSelect}
              onMoveToStage={handleMoveToStage}
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
      />
    </div>
  );
}
