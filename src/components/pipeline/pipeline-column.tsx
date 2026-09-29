"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { OpportunityCard } from "./opportunity-card";
import { STAGE_LABELS, type OpportunityStage } from "@/lib/opportunity-stages";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

export interface PipelineColumnProps {
  stage: OpportunityStage;
  opportunities: OpportunityListItem[];
  onSelect: (opportunity: OpportunityListItem) => void;
  onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void;
  draggable?: boolean;
  readOnly?: boolean;
}

export function PipelineColumn({
  stage,
  opportunities,
  onSelect,
  onMoveToStage,
  draggable = false,
  readOnly = false,
}: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[280px] shrink-0 flex-col gap-2 rounded-md border border-border bg-card p-2",
        isOver && "border-primary",
      )}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-sm font-medium">{STAGE_LABELS[stage]}</span>
        <span className="text-xs text-muted-foreground">{opportunities.length}</span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto">
        {opportunities.map((opportunity) => (
          <OpportunityCard
            key={opportunity.id}
            opportunity={opportunity}
            onSelect={onSelect}
            onMoveToStage={onMoveToStage}
            draggable={draggable}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}
