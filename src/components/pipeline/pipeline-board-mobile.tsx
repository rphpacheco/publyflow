"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PipelineColumn } from "./pipeline-column";
import { STAGES, type OpportunityStage } from "@/lib/opportunity-stages";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

export interface PipelineBoardMobileProps {
  opportunities: OpportunityListItem[];
  onSelect: (opportunity: OpportunityListItem) => void;
  onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void;
}

export function PipelineBoardMobile({
  opportunities,
  onSelect,
  onMoveToStage,
}: PipelineBoardMobileProps) {
  const [index, setIndex] = React.useState(0);
  const stage = STAGES[index]!;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          disabled={index === 0}
          aria-label="Stage anterior"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => setIndex((current) => Math.min(STAGES.length - 1, current + 1))}
          disabled={index === STAGES.length - 1}
          aria-label="Próximo stage"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <PipelineColumn
        stage={stage}
        opportunities={opportunities.filter((item) => item.stage === stage)}
        onSelect={onSelect}
        onMoveToStage={onMoveToStage}
      />
    </div>
  );
}
