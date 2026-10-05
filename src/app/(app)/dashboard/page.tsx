"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useIsCreator } from "@/components/shell/session-role-context";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { WonChart } from "@/components/dashboard/won-chart";
import { PipelineCard } from "@/components/dashboard/pipeline-card";
import { CreatorsTable } from "@/components/dashboard/creators-table";
import { ActionsPanel } from "@/components/dashboard/actions-panel";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { useDashboardActions, useDashboardMetrics, type PeriodMetricsDto } from "@/hooks/use-dashboard";
import { computeDelta } from "@/lib/dashboard/delta";
import { periodQuerySchema, resolvePreset, type Period } from "@/lib/dashboard/period";
import { formatCurrencyBRL } from "@/lib/format";

const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const money = (cents: number | null) => (cents === null ? "—" : formatCurrencyBRL(cents));
const days = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ErrorBox({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-2 p-4">
      <p className="text-sm text-muted-foreground">Não foi possível carregar</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button>
    </Card>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />;
}

function cards(current: PeriodMetricsDto, previous: PeriodMetricsDto) {
  return [
    { label: "Fechado", value: money(current.wonCents), context: plural(current.wonCount, "oportunidade", "oportunidades"), delta: computeDelta(current.wonCents, previous.wonCents, "money", true) },
    { label: "Taxa de fechamento", value: percent(current.winRate), context: `${current.wonCount} ganhas · ${current.lostCount} perdidas`, delta: computeDelta(current.winRate, previous.winRate, "rate", true) },
    { label: "Ticket médio", value: money(current.averageTicketCents), context: "por oportunidade ganha", delta: computeDelta(current.averageTicketCents, previous.averageTicketCents, "money", true) },
    { label: "Tempo até fechar", value: days(current.averageDaysToClose), context: "média das fechadas", delta: computeDelta(current.averageDaysToClose, previous.averageDaysToClose, "days", false) },
    { label: "Mensagens recebidas", value: String(current.inquiriesReceived), context: plural(current.inquiriesConverted, "convertida", "convertidas"), delta: computeDelta(current.inquiriesReceived, previous.inquiriesReceived, "count", true) },
    { label: "Conversão Inbox para oportunidade", value: percent(current.conversionRate), context: "das mensagens do período", delta: computeDelta(current.conversionRate, previous.conversionRate, "rate", true) },
    { label: "Oportunidades criadas", value: String(current.opportunitiesCreated), context: "no período", delta: computeDelta(current.opportunitiesCreated, previous.opportunitiesCreated, "count", true) },
    { label: "Perdidas", value: String(current.lostCount), context: "no período", delta: computeDelta(current.lostCount, previous.lostCount, "count", false) },
  ];
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isCreator = useIsCreator();
  const parsed = periodQuerySchema.safeParse({ from: searchParams.get("from") ?? undefined, to: searchParams.get("to") ?? undefined });
  const period: Period = parsed.success ? parsed.data : resolvePreset("this_month", new Date());
  const metrics = useDashboardMetrics(period);
  const actions = useDashboardActions();

  React.useEffect(() => {
    if (isCreator) router.replace("/pipeline");
  }, [isCreator, router]);
  if (isCreator) return null;

  const setPeriod = (next: Period) => router.replace(`/dashboard?from=${next.from}&to=${next.to}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <aside className="order-first lg:order-last lg:sticky lg:top-4 lg:self-start">
          {actions.isLoading ? <Skeleton className="h-64" /> : actions.isError || !actions.data ? <ErrorBox onRetry={() => actions.refetch()} /> : <ActionsPanel actions={actions.data} />}
        </aside>
        <section className="flex min-w-0 flex-col gap-4">
          {metrics.isLoading ? (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : metrics.isError || !metrics.data ? (
            <ErrorBox onRetry={() => metrics.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {cards(metrics.data.current, metrics.data.previous).map((card) => <KpiCard key={card.label} {...card} />)}
              </div>
              <WonChart points={metrics.data.series.points} bucket={metrics.data.series.bucket} />
              <PipelineCard openNow={metrics.data.openNow} funnel={metrics.data.funnel} />
              <CreatorsTable creators={metrics.data.creators} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <React.Suspense fallback={null}>
      <DashboardContent />
    </React.Suspense>
  );
}
