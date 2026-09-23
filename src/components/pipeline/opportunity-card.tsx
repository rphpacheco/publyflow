"use client";

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
}

export function OpportunityCard({ opportunity, onSelect, onMoveToStage }: OpportunityCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opportunity.id,
  });

  const label = opportunity.brandName ?? opportunity.companyName ?? opportunity.contactName;
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <Card
        className={cn(
          "flex cursor-pointer flex-col gap-1 p-3 text-sm",
          isDragging && "opacity-50",
        )}
        onClick={() => onSelect(opportunity)}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium">{label}</span>
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
