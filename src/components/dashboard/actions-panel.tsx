import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardActionsDto } from "@/hooks/use-dashboard";

type Tone = "red" | "amber" | "violet" | "green" | "gray";
const PILL: Record<Tone, string> = {
  red: "bg-error/10 text-error",
  amber: "bg-warning/10 text-warning",
  violet: "bg-info/10 text-info",
  green: "bg-success/10 text-success",
  gray: "bg-muted text-foreground",
};

function Row({ label, href, count, tone }: { label: string; href: string; count: number; tone: Tone }) {
  const zero = count === 0;
  return (
    <li>
      <Link href={href} data-zero={zero ? "true" : "false"} className={cn("flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted", zero && "opacity-50")}>
        <span className="min-w-0 break-words">{label}</span>
        <span className={cn("min-w-7 shrink-0 rounded-full px-2 text-center text-xs font-semibold", PILL[tone])}>
          {count}
        </span>
      </Link>
    </li>
  );
}

export function ActionsPanel({ actions }: { actions: DashboardActionsDto }) {
  const pending = [
    actions.untriagedInquiries, actions.clientChangesRequested, actions.creatorChangesRequested,
    actions.awaitingCreatorApproval, actions.readyToSend,
  ];
  const allClear = pending.every((n) => n === 0);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Card className="min-w-0 p-3">
        <h2 className="mb-1 px-2 text-sm font-medium">Requer ação</h2>
        {allClear ? (
          <p className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-success" aria-hidden /> Tudo em dia
          </p>
        ) : null}
        <ul>
          <Row label="Mensagens sem triagem" href="/inbox" count={actions.untriagedInquiries} tone="red" />
          <Row label="Ajustes pedidos pelo cliente" href="/proposals" count={actions.clientChangesRequested} tone="amber" />
          <Row label="Ajustes pedidos pelo creator" href="/proposals" count={actions.creatorChangesRequested} tone="amber" />
          <Row label="Aguardando aprovação do creator" href="/proposals" count={actions.awaitingCreatorApproval} tone="violet" />
          <Row label="Prontas para enviar" href="/proposals" count={actions.readyToSend} tone="green" />
        </ul>
      </Card>
      <Card className="min-w-0 p-3">
        <h2 className="mb-1 px-2 text-sm font-medium">Acompanhamento</h2>
        <ul>
          <Row label="Aguardando resposta do cliente" href="/proposals" count={actions.awaitingClient} tone="gray" />
        </ul>
      </Card>
    </div>
  );
}
