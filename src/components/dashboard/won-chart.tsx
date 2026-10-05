"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { formatCurrencyBRL } from "@/lib/format";
import type { Bucket } from "@/lib/dashboard/period";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function bucketLabel(start: string, bucket: Bucket): string {
  const [y, m, d] = start.split("-");
  return bucket === "month" ? `${MONTHS[Number(m) - 1]}/${y.slice(2)}` : `${d}/${m}`;
}

export function formatAxisBRL(value: number): string {
  const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const abs = Math.abs(value);
  if (abs >= 1_000_000 || round1(abs / 1_000) >= 1_000) return `R$ ${fmt(round1(value / 1_000_000))} mi`;
  if (abs >= 1_000) return `R$ ${fmt(round1(value / 1_000))} mil`;
  return `R$ ${fmt(value)}`;
}

export function WonChart({ points, bucket }: { points: Array<{ start: string; wonCents: number; wonCount: number }>; bucket: Bucket }) {
  const data = points.map((p) => ({ ...p, label: bucketLabel(p.start, bucket), value: p.wonCents / 100 }));
  return (
    <Card className="min-w-0 p-4">
      <h2 className="mb-3 text-sm font-medium">Fechado ao longo do período</h2>
      <div className="h-48 min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: 0, right: 12, top: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={84} tickFormatter={formatAxisBRL} />
            <Tooltip
              formatter={(value) => [formatCurrencyBRL(Number(value) * 100), "Fechado"]}
              labelFormatter={(label, payload) => {
                const count = (payload?.[0]?.payload as { wonCount?: number } | undefined)?.wonCount ?? 0;
                return `${label} · ${count} ${count === 1 ? "oportunidade" : "oportunidades"}`;
              }}
            />
            <Area type="monotone" dataKey="value" stroke="var(--color-primary, #6d5bd0)" fill="var(--color-primary, #6d5bd0)" fillOpacity={0.12} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
