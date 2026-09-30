"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { useApproveProposal, useRequestProposalChanges, type SendStateApprovalDto } from "@/hooks/use-proposal-sending";
import { formatDateTime } from "@/lib/presentation/format";

/** Spec D §7.2: the creator's side of the approval. */
export function ProposalApprovalBlock({
  proposalId,
  approval,
  sentWithoutApproval = false,
}: {
  proposalId: string;
  approval: SendStateApprovalDto;
  /** The pending request's version was already sent to the client without waiting for this decision (spec D final review F5). */
  sentWithoutApproval?: boolean;
}) {
  const approve = useApproveProposal(proposalId);
  const requestChanges = useRequestProposalChanges(proposalId);
  const [confirmApprove, setConfirmApprove] = React.useState(false);
  const [changesOpen, setChangesOpen] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const busy = approve.isPending || requestChanges.isPending;

  if (!approval.required || !approval.current || approval.state === "none" || approval.state === "not_required") return null;
  const current = approval.current;

  return (
    <section aria-label="Aprovação" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Aprovação</h2>
      {approval.state === "pending" && sentWithoutApproval ? (
        <p className="text-sm text-muted-foreground">A agência enviou esta versão sem a sua aprovação.</p>
      ) : approval.state === "pending" ? (
        <>
          <p className="text-sm text-muted-foreground">{current.requestedByName} pediu sua aprovação desta versão.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => setConfirmApprove(true)}>
              Aprovar
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setChangesOpen(true)}>
              Pedir ajustes
            </Button>
          </div>
        </>
      ) : null}
      {approval.state === "approved" && current.decidedAt ? (
        <p className="text-sm text-muted-foreground">Você aprovou esta versão em {formatDateTime(new Date(current.decidedAt))}.</p>
      ) : null}
      {approval.state === "changes_requested" && current.decidedAt ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-muted-foreground">Você pediu ajustes em {formatDateTime(new Date(current.decidedAt))}:</p>
          <blockquote className="whitespace-pre-line border-l-2 border-border pl-3">{current.message}</blockquote>
        </div>
      ) : null}
      {approval.state === "stale" ? (
        <p className="text-sm text-warning">A proposta mudou depois do pedido. Aguarde um novo pedido da agência.</p>
      ) : null}

      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar proposta</AlertDialogTitle>
            <AlertDialogDescription>A agência poderá enviar esta versão ao cliente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={busy}
                onClick={() => {
                  setConfirmApprove(false);
                  approve.mutate({ approvalId: current.id });
                }}
              >
                Aprovar
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={changesOpen} onOpenChange={setChangesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pedir ajustes</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = message.trim();
              if (!trimmed) return;
              requestChanges.mutate(
                { approvalId: current.id, message: trimmed },
                {
                  onSuccess: () => {
                    setChangesOpen(false);
                    setMessage("");
                  },
                },
              );
            }}
          >
            <label htmlFor="approval-changes" className="text-sm font-medium">
              O que precisa mudar?
            </label>
            <Textarea id="approval-changes" value={message} maxLength={2000} onChange={(event) => setMessage(event.target.value)} />
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setChangesOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy || message.trim().length === 0}>
                Enviar pedido
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
