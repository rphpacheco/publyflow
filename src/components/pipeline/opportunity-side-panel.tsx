"use client";

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
import { relativeTime, formatCurrencyBRL } from "@/lib/format";
import { STAGES, STAGE_LABELS, type OpportunityStage } from "@/lib/opportunity-stages";
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
      </SheetContent>
    </Sheet>
  );
}
