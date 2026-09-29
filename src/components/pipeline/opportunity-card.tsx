"use client";

import type { KeyboardEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { relativeTime, formatCurrencyBRL } from "@/lib/format";
import { STAGES, STAGE_LABELS, type OpportunityStage } from "@/lib/opportunity-stages";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

export interface OpportunityCardProps {
  opportunity: OpportunityListItem;
  onSelect: (opportunity: OpportunityListItem) => void;
  onMoveToStage: (opportunityId: string, stage: OpportunityStage) => void;
  draggable?: boolean;
  readOnly?: boolean;
}

export function OpportunityCard({
  opportunity,
  onSelect,
  onMoveToStage,
  draggable = false,
  readOnly = false,
}: OpportunityCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: opportunity.id,
    disabled: readOnly,
  });

  const label = opportunity.brandName ?? opportunity.companyName ?? opportunity.contactName;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      if (event.key === " ") event.preventDefault();
      onSelect(opportunity);
    }
  }

  return (
    <div
      ref={setNodeRef}
      tabIndex={0}
      onClick={() => onSelect(opportunity)}
      onKeyDown={handleKeyDown}
      {...(draggable && !readOnly ? listeners : undefined)}
      {...(draggable && !readOnly ? attributes : undefined)}
    >
      <Card
        className={cn(
          "flex cursor-pointer flex-col gap-1 p-3 text-sm",
          isDragging && "opacity-50",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium">{label}</span>
          {readOnly ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 md:size-8"
                  onClick={(event) => event.stopPropagation()}
                  aria-label="Mover para..."
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                {STAGES.map((stage) => (
                  <DropdownMenuItem
                    key={stage}
                    disabled={stage === opportunity.stage}
                    onSelect={() => onMoveToStage(opportunity.id, stage)}
                  >
                    {STAGE_LABELS[stage]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {opportunity.estimatedValueCents !== null ? (
          <span className="text-muted-foreground">
            {formatCurrencyBRL(opportunity.estimatedValueCents)}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">{relativeTime(opportunity.createdAt)}</span>
      </Card>
    </div>
  );
}
