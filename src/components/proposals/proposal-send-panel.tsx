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
import { useProposalSendState, usePublishProposal, useRequestApproval, type SendStateDto } from "@/hooks/use-proposal-sending";
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
  const requestApproval = useRequestApproval(proposalId);
  const [confirm, setConfirm] = React.useState<{ status: SendStateDto["status"]; withoutApproval: boolean } | null>(null);
  const [sentPath, setSentPath] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [confirmWithoutApproval, setConfirmWithoutApproval] = React.useState(false);

  if (!state || state.status === "ARCHIVED") return null;

  const publication = state.latestPublication;
  const response = publication?.response ?? null;
  const approval = state.approval;
  const gated = approval.required && state.canSend && approval.state !== "approved";
  const creatorName = approval.creatorName ?? "O creator";
  const busy = publish.isPending || requestApproval.isPending || checking;

  function send(options?: { withoutApproval?: boolean }) {
    publish.mutate(options?.withoutApproval ? { withoutApproval: true } : undefined, {
      onSuccess: (result) => setSentPath(result.publicPath),
    });
  }

  // Decide on the server's current state, not the one loaded with the page:
  // the client may have accepted or rejected since. Also used by "Enviar
  // sem aprovação" so it never silently reopens an accepted/rejected round.
  async function checkAndSend(options?: { withoutApproval?: boolean }) {
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
        setConfirm({ status: fresh.status, withoutApproval: options?.withoutApproval === true });
      } else {
        send(options);
      }
    } finally {
      setChecking(false);
    }
  }

  function onSendClick() {
    return checkAndSend();
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

      {approval.required && state.canSend ? (
        <div className="flex flex-col gap-2" aria-label="Aprovação do creator">
          <h2 className="text-sm font-semibold">Aprovação do creator</h2>
          {approval.state === "none" ? <p className="text-sm text-muted-foreground">Este creator precisa aprovar a proposta antes do envio.</p> : null}
          {approval.state === "pending" && approval.current ? (
            <p className="text-sm text-muted-foreground">Aguardando aprovação de {creatorName} (versão {approval.current.versionNumber}).</p>
          ) : null}
          {approval.state === "approved" && approval.current?.decidedAt ? (
            <p className="text-sm text-muted-foreground">Aprovada por {creatorName} em {formatDateTime(new Date(approval.current.decidedAt))}.</p>
          ) : null}
          {approval.state === "changes_requested" && approval.current ? (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-muted-foreground">{creatorName} pediu ajustes:</p>
              <blockquote className="whitespace-pre-line border-l-2 border-border pl-3">{approval.current.message}</blockquote>
            </div>
          ) : null}
          {approval.state === "stale" ? <p className="text-sm text-warning">A proposta mudou depois do pedido de aprovação.</p> : null}
          {gated ? (
            <div className="flex flex-wrap gap-2">
              {approval.state !== "pending" ? (
                <Button type="button" size="sm" disabled={busy} onClick={() => requestApproval.mutate()}>
                  Pedir aprovação
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmWithoutApproval(true)}>
                Enviar sem aprovação
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {gated ? null : (
          <Button type="button" size="sm" onClick={onSendClick} disabled={!state.canSend || publish.isPending || checking}>
            {checking ? "Verificando…" : publication ? "Reenviar" : "Enviar proposta"}
          </Button>
        )}
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

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abrir nova rodada?</AlertDialogTitle>
            <AlertDialogDescription>{confirm ? CONFIRM_COPY[confirm.status] : null}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={() => {
                  const options = confirm ? { withoutApproval: confirm.withoutApproval } : undefined;
                  setConfirm(null);
                  send(options);
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

      <AlertDialog open={confirmWithoutApproval} onOpenChange={setConfirmWithoutApproval}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar sem aprovação</AlertDialogTitle>
            <AlertDialogDescription>
              {creatorName} ainda não aprovou esta versão. A proposta será enviada ao cliente e {creatorName} será avisado(a).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  setConfirmWithoutApproval(false);
                  void checkAndSend({ withoutApproval: true });
                }}
              >
                Enviar sem aprovação
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
