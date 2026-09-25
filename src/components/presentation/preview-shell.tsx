"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUpdateProposal } from "@/hooks/use-proposal";
import {
  PROPOSAL_THEMES,
  PROPOSAL_THEME_LABELS,
  type ProposalStatus,
  type ProposalTheme,
} from "@/lib/proposal-themes";
import type { PresentationModel } from "@/lib/presentation/types";
import { themeParamValue } from "@/lib/presentation/theme-param";
import { PresentationRenderer } from "./presentation-renderer";

export interface PreviewShellProps {
  proposalId: string;
  model: PresentationModel;
  savedTheme: ProposalTheme;
  status: ProposalStatus;
  initialTheme: ProposalTheme;
}

type Viewport = "desktop" | "mobile";

// Native history API: updates ?theme= without a navigation, so the Server
// Component doesn't refetch the proposal (Next integrates replaceState with
// its router).
function writeThemeParam(theme: ProposalTheme | null) {
  const url = new URL(window.location.href);
  if (theme) {
    url.searchParams.set("theme", themeParamValue(theme));
  } else {
    url.searchParams.delete("theme");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function PreviewShell({ proposalId, model, savedTheme: initialSavedTheme, status, initialTheme }: PreviewShellProps) {
  const [theme, setTheme] = React.useState<ProposalTheme>(initialTheme);
  const [savedTheme, setSavedTheme] = React.useState<ProposalTheme>(initialSavedTheme);
  const [viewport, setViewport] = React.useState<Viewport>("desktop");
  const updateProposal = useUpdateProposal(proposalId);
  const router = useRouter();

  const canApply = theme !== savedTheme && status !== "ARCHIVED";

  function selectTheme(next: ProposalTheme) {
    setTheme(next);
    writeThemeParam(next === savedTheme ? null : next);
  }

  function applyTheme() {
    const applied = theme;
    updateProposal.mutate(
      { theme: applied },
      {
        onSuccess: () => {
          setSavedTheme(applied);
          writeThemeParam(null);
          toast.success("Tema aplicado.");
          router.refresh();
        },
      },
    );
  }

  const renderer = <PresentationRenderer model={model} theme={theme} />;

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <header
        aria-label="Pré-visualização"
        className="sm:sticky sm:top-0 sm:z-10 flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3"
      >
        <Link
          href={`/proposals/${proposalId}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Voltar ao editor
        </Link>

        <div role="group" aria-label="Tema" className="flex flex-wrap gap-1">
          {PROPOSAL_THEMES.map((item) => (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={item === theme ? "default" : "outline"}
              aria-pressed={item === theme}
              onClick={() => selectTheme(item)}
            >
              {PROPOSAL_THEME_LABELS[item]}
              {item === savedTheme ? " (atual)" : null}
            </Button>
          ))}
        </div>

        {canApply ? (
          <Button type="button" size="sm" onClick={applyTheme} disabled={updateProposal.isPending}>
            Aplicar este tema
          </Button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {model.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">Adicione itens para mostrar valores</p>
          ) : null}
          <div role="group" aria-label="Tamanho da tela" className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={viewport === "desktop" ? "default" : "outline"}
              aria-pressed={viewport === "desktop"}
              onClick={() => setViewport("desktop")}
            >
              <Monitor className="size-4" aria-hidden="true" />
              Desktop
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewport === "mobile" ? "default" : "outline"}
              aria-pressed={viewport === "mobile"}
              onClick={() => setViewport("mobile")}
            >
              <Smartphone className="size-4" aria-hidden="true" />
              Celular
            </Button>
          </div>
        </div>
      </header>

      <div className={cn("flex-1", viewport === "mobile" && "flex justify-center px-4 py-6")}>
        {viewport === "mobile" ? (
          <div
            data-testid="mobile-frame"
            className="w-[390px] max-w-full overflow-hidden rounded-[32px] border-8 border-foreground/80 shadow-xl"
          >
            {renderer}
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            <PresentationRenderer model={model} theme={theme} className="flex-1" />
          </div>
        )}
      </div>
    </div>
  );
}
