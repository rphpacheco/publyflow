import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Delta } from "@/lib/dashboard/delta";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<Delta["tone"], string> = {
  good: "text-success",
  bad: "text-error",
  neutral: "text-muted-foreground",
};

export function KpiCard({ label, value, context, delta }: { label: string; value: string; context?: string; delta: Delta }) {
  const Icon = delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  return (
    <Card className="@container flex min-w-0 flex-col gap-1 p-4">
      <span className="min-w-0 break-words text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere] @[14rem]:text-2xl">{value}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
        {context ? <span className="min-w-0 break-words text-muted-foreground">{context}</span> : null}
        <span data-testid="kpi-delta" data-tone={delta.tone} className={cn("inline-flex items-center gap-0.5", TONE_CLASS[delta.tone])}>
          {delta.label ? (
            <>
              <Icon className="size-3.5" aria-hidden />
              {delta.label}
              <span className="sr-only"> em relação ao período anterior</span>
            </>
          ) : (
            "—"
          )}
        </span>
      </div>
    </Card>
  );
}
