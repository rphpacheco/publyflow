"use client";

import * as React from "react";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { periodQuerySchema, resolvePreset, type Period, type Preset } from "@/lib/dashboard/period";

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: "this_month", label: "Este mês" },
  { id: "last_month", label: "Mês passado" },
  { id: "last_90_days", label: "90 dias" },
  { id: "this_year", label: "Este ano" },
];

const formatDate = (date: string) => date.split("-").reverse().join("/");

export function PeriodPicker({ period, onChange, now = new Date() }: { period: Period; onChange: (period: Period) => void; now?: Date }) {
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(period.from);
  const [to, setTo] = React.useState(period.to);
  const [error, setError] = React.useState<string | null>(null);
  const active = PRESETS.find((p) => {
    const r = resolvePreset(p.id, now);
    return r.from === period.from && r.to === period.to;
  })?.id;

  function apply() {
    const parsed = periodQuerySchema.safeParse({ from, to });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Período inválido.");
      return;
    }
    setError(null);
    setOpen(false);
    onChange(parsed.data);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Período">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={active === preset.id}
            onClick={() => onChange(resolvePreset(preset.id, now))}
            className={active === preset.id ? "bg-foreground px-3 py-1.5 text-sm text-background" : "px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setFrom(period.from);
            setTo(period.to);
            setError(null);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="gap-2">
            <CalendarRange className="size-4" aria-hidden />
            {active ? "De/até" : `${formatDate(period.from)} – ${formatDate(period.to)}`}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-72 flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            De
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Até
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {error ? <p role="alert" className="text-xs text-error">{error}</p> : null}
          <Button type="button" onClick={apply}>Aplicar</Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
