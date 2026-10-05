import Link from "next/link";
import { Card } from "@/components/ui/card";
import { STAGE_LABELS, type OpportunityStage } from "@/lib/opportunity-stages";
import { formatCurrencyBRL } from "@/lib/format";

const BAR_COLORS = ["#f97316", "#14b8a6", "#6366f1", "#eab308", "#0ea5e9", "#a855f7", "#ec4899", "#22c55e"];

export function PipelineCard({ openNow, funnel }: { openNow: { count: number; valueCents: number }; funnel: Array<{ stage: OpportunityStage; count: number }> }) {
  const max = Math.max(1, ...funnel.map((f) => f.count));
  return (
    <Card className="min-w-0 p-4">
      <h2 className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm font-medium">
        Pipeline agora
        <span className="font-normal text-muted-foreground">
          {openNow.count} {openNow.count === 1 ? "aberta" : "abertas"} · {formatCurrencyBRL(openNow.valueCents)} em negociação
        </span>
      </h2>
      <ul className="flex flex-col gap-2">
        {funnel.map((entry, index) => (
          <li key={entry.stage}>
            <Link href="/pipeline" className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_2rem] items-center gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-muted">
              <span className="min-w-0 break-words">{STAGE_LABELS[entry.stage]}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full" style={{ width: `${(entry.count / max) * 100}%`, backgroundColor: BAR_COLORS[index % BAR_COLORS.length] }} />
              </span>
              <span className="text-right font-medium tabular-nums">{entry.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
