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

/**
 * Pure resolution of a dnd-kit drag-end event into a stage change, or null when the drop
 * should be a no-op: dropped outside any droppable (`event.over` is null/undefined), the
 * dragged opportunity can't be found, or it was dropped back on its current stage.
 */
export function resolveDragEndStageChange(
  opportunities: OpportunityListItem[],
  event: DragEndEvent,
): { opportunityId: string; stage: OpportunityStage } | null {
  const opportunityId = event.active.id as string;
  const newStage = event.over?.id as OpportunityStage | undefined;
  if (!newStage) return null;

  const opportunity = opportunities.find((item) => item.id === opportunityId);
  if (!opportunity || opportunity.stage === newStage) return null;

  return { opportunityId, stage: newStage };
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
    const change = resolveDragEndStageChange(opportunities, event);
    if (!change) return;
    onMoveToStage(change.opportunityId, change.stage);
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
