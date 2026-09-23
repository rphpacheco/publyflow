"use client";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { PipelineColumn } from "./pipeline-column";
import { STAGES, type OpportunityStage } from "@/lib/opportunity-stages";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

export interface PipelineBoardDesktopProps {
  opportunities: OpportunityListItem[];
  onSelect: (opportunity: OpportunityListItem) => void;
  onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void;
}

export function PipelineBoardDesktop({
  opportunities,
  onSelect,
  onMoveToStage,
}: PipelineBoardDesktopProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const opportunityId = event.active.id as string;
    const newStage = event.over?.id as OpportunityStage | undefined;
    if (!newStage) return;

    const opportunity = opportunities.find((item) => item.id === opportunityId);
    if (!opportunity || opportunity.stage === newStage) return;

    onMoveToStage(opportunityId, newStage);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => (
          <PipelineColumn
            key={stage}
            stage={stage}
            opportunities={opportunities.filter((item) => item.stage === stage)}
            onSelect={onSelect}
            onMoveToStage={onMoveToStage}
          />
        ))}
      </div>
    </DndContext>
  );
}
