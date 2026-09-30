"use client";

import * as React from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useIsCreator } from "@/components/shell/session-role-context";
import { useProposalQueue } from "@/hooks/use-proposal-queue";
import { detailLine, groupsFor, shortDate } from "@/lib/proposals/queue-labels";
import { formatBRL } from "@/lib/presentation/format";

export default function ProposalsPage() {
  const isCreator = useIsCreator();
  const viewer = isCreator ? "creator" : "agency";
  const [showArchived, setShowArchived] = React.useState(false);
  const { data, isLoading, isError, refetch } = useProposalQueue(showArchived);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Propostas</h1>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((value) => !value)}
        >
          {showArchived ? "Ocultar arquivadas" : "Mostrar arquivadas"}
        </Button>
      </div>

      {isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando...
        </p>
      ) : null}

      {isError && !data ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">Não foi possível carregar as propostas.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhuma proposta ainda."
          description="Propostas são criadas a partir de uma oportunidade no Pipeline."
          action={
            <Button asChild size="sm">
              <Link href="/pipeline">Ir para o Pipeline</Link>
            </Button>
          }
        />
      ) : null}

      {data && data.truncated ? <p className="text-xs text-muted-foreground">Mostrando as 200 propostas mais recentes.</p> : null}

      {data
        ? groupsFor(viewer).map((group) => {
            const items = data.items.filter((item) => group.situations.includes(item.situation));
            if (items.length === 0) return null;
            const headingId = `${group.key}-heading`;
            return (
              <section key={group.key} aria-labelledby={headingId} className="flex flex-col gap-2">
                <h2 id={headingId} className="text-sm font-semibold">
                  {group.label} ({items.length})
                </h2>
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/proposals/${item.id}`}
                        className="flex flex-col gap-1 p-3 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium">{item.title}</span>
                          {(() => {
                            const subtitle = [isCreator ? null : item.creatorName, item.counterpartName].filter(Boolean).join(" · ");
                            return subtitle ? <span className="truncate text-xs text-muted-foreground">{subtitle}</span> : null;
                          })()}
                          <span className="text-xs text-muted-foreground">{detailLine(item, viewer)}</span>
                        </div>
                        <div className="flex shrink-0 flex-col items-start gap-0.5 sm:items-end">
                          <span className="text-sm font-medium">{formatBRL(item.totalCents)}</span>
                          <span className="text-xs text-muted-foreground">{shortDate(item.lastActivityAt)}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        : null}
    </div>
  );
}
