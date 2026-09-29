"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useProposalSendState, usePublishProposal, type SendStateDto } from "@/hooks/use-proposal-sending";
import { formatDateTime, formatIssuedAt } from "@/lib/presentation/format";
import { ProposalStatusBadge } from "./proposal-status-badge";
import { ProposalShareActions } from "./proposal-share-actions";

const DISABLED_HINT: Partial<Record<SendStateDto["status"], string>> = {
  SENT: "Nada mudou desde o envio",
  CHANGES_REQUESTED: "Edite a proposta e reenvie",
};

const CONFIRM_COPY: Partial<Record<SendStateDto["status"], string>> = {
  APPROVED: "Esta proposta já foi aceita. Reenviar abre uma nova rodada e o status volta para Enviada.",
  REJECTED: "Esta proposta já foi recusada. Reenviar abre uma nova rodada e o status volta para Enviada.",
};

function absoluteUrl(publicPath: string) {
  return typeof window === "undefined" ? publicPath : `${window.location.origin}${publicPath}`;
}

async function copyLink(publicPath: string) {
  try {
    await navigator.clipboard.writeText(absoluteUrl(publicPath));
    toast.success("Link copiado.");
  } catch {
    toast.error("Não foi possível copiar o link.");
  }
}

/** Renders only what GET /send-state computed; never derives state itself. */
export function ProposalSendPanel({ proposalId }: { proposalId: string }) {
  const sendStateQuery = useProposalSendState(proposalId);
  const state = sendStateQuery.data;
  const publish = usePublishProposal(proposalId);
  const [confirmStatus, setConfirmStatus] = React.useState<SendStateDto["status"] | null>(null);
  const [sentPath, setSentPath] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);

  if (!state || state.status === "ARCHIVED") return null;

  const publication = state.latestPublication;
  const response = publication?.response ?? null;

  function send() {
    publish.mutate(undefined, { onSuccess: (result) => setSentPath(result.publicPath) });
  }

  // Decide on the server's current state, not the one loaded with the page:
  // the client may have accepted or rejected since.
  async function onSendClick() {
    setChecking(true);
    try {
      const result = await sendStateQuery.refetch();
      const fresh = result.data;
      if (result.isError || !fresh) {
        toast.error("Não foi possível verificar o estado da proposta. Tente novamente.");
        return;
      }
      if (!fresh.canSend) return;
      if (CONFIRM_COPY[fresh.status]) {
        setConfirmStatus(fresh.status);
      } else {
        send();
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <section aria-label="Envio" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Negociação</h2>
        {!publication ? (
          <p className="text-sm text-muted-foreground">Ainda não enviada.</p>
        ) : !response ? (
          <p className="text-sm text-muted-foreground">
            Aguardando resposta · versão {publication.versionNumber} enviada em {formatIssuedAt(new Date(publication.publishedAt))}
          </p>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <div>
              <ProposalStatusBadge status={state.status} />
            </div>
            <p className="text-muted-foreground">
              {response.respondentName} · {response.respondentEmail} · {formatDateTime(new Date(response.respondedAt))}
            </p>
            {response.message ? (
              <blockquote className="whitespace-pre-line border-l-2 border-border pl-3">{response.message}</blockquote>
            ) : null}
          </div>
        )}
      </div>

      {publication && (state.hasUnsentChanges || state.status === "DRAFT") ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Documento</h2>
          {state.status === "DRAFT" ? (
            <p role="status" className="text-sm text-warning">O link está desativado até você reenviar.</p>
          ) : (
            <p role="status" className="text-sm text-warning">
              Alterações não enviadas — o cliente ainda vê a versão {publication.versionNumber}.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={onSendClick} disabled={!state.canSend || publish.isPending || checking}>
          {checking ? "Verificando…" : publication ? "Reenviar" : "Enviar proposta"}
        </Button>
        {state.publicPath ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => copyLink(state.publicPath!)}>
              Copiar link
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={state.publicPath} target="_blank" rel="noopener noreferrer">
                Abrir
              </a>
            </Button>
            <ProposalShareActions proposalId={proposalId} publicPath={state.publicPath} />
          </>
        ) : null}
      </div>
      {!state.canSend && DISABLED_HINT[state.status] ? (
        <p className="text-xs text-muted-foreground">{DISABLED_HINT[state.status]}</p>
      ) : null}

      <AlertDialog open={confirmStatus !== null} onOpenChange={(open) => !open && setConfirmStatus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abrir nova rodada?</AlertDialogTitle>
            <AlertDialogDescription>{confirmStatus ? CONFIRM_COPY[confirmStatus] : null}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={() => {
                  setConfirmStatus(null);
                  send();
                }}
              >
                Reenviar
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={sentPath !== null} onOpenChange={(open) => !open && setSentPath(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proposta enviada</DialogTitle>
            <DialogDescription>Envie este link ao cliente pelo canal que você já usa.</DialogDescription>
          </DialogHeader>
          {sentPath ? (
            <div className="flex flex-col gap-3">
              <Input readOnly value={absoluteUrl(sentPath)} aria-label="Link da proposta" onFocus={(event) => event.target.select()} />
              <div className="flex gap-2">
                <Button type="button" onClick={() => copyLink(sentPath)}>
                  Copiar link
                </Button>
                <Button asChild variant="outline">
                  <a href={sentPath} target="_blank" rel="noopener noreferrer">
                    Abrir
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Ou envie direto:</p>
              <ProposalShareActions proposalId={proposalId} publicPath={sentPath} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
