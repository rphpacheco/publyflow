"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PresentationAction } from "@/lib/presentation/types";

const COPY: Record<PresentationAction, { title: string; messageLabel: string | null; messageRequired: boolean }> = {
  accept: { title: "Aceitar proposta", messageLabel: null, messageRequired: false },
  request_changes: { title: "Pedir ajustes", messageLabel: "Mensagem", messageRequired: true },
  reject: { title: "Recusar proposta", messageLabel: "Motivo (opcional)", messageRequired: false },
};

export interface ResponseDialogValues {
  name: string;
  email: string;
  message: string | null;
}

export function ResponseDialog({
  action,
  versionNumber,
  publishedAtLabel,
  pending,
  serverError,
  onSubmit,
  onReload,
  onOpenChange,
}: {
  action: PresentationAction | null;
  versionNumber: number;
  publishedAtLabel: string;
  pending: boolean;
  serverError: { message: string; reload: boolean } | null;
  onSubmit: (values: ResponseDialogValues) => void;
  onReload: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const copy = action ? COPY[action] : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError("Informe nome e e-mail.");
      return;
    }
    if (copy?.messageRequired && !message.trim()) {
      setError("Descreva os ajustes que você gostaria.");
      return;
    }
    setError(null);
    onSubmit({ name: name.trim(), email: email.trim(), message: message.trim() || null });
  }

  return (
    <Dialog open={action !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          {action === "accept" ? (
            <DialogDescription>
              Você está aceitando a versão {versionNumber} desta proposta, enviada em {publishedAtLabel}.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Nome
            <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            E-mail
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          {copy?.messageLabel ? (
            <label className="flex flex-col gap-1 text-sm">
              {copy.messageLabel}
              <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={2000} />
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          ) : null}
          {serverError ? (
            <div role="alert" className="flex flex-col gap-2 text-sm text-error">
              <p>{serverError.message}</p>
              {serverError.reload ? (
                <Button type="button" variant="outline" size="sm" onClick={onReload}>
                  Recarregar
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" disabled={pending}>
            Confirmar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
