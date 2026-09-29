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

export type ResponseFieldErrors = Partial<Record<"name" | "email" | "message", string>>;

export function ResponseDialog({
  action,
  versionNumber,
  publishedAtLabel,
  pending,
  serverError,
  fieldErrors,
  onFieldEdit,
  onSubmit,
  onReload,
  onOpenChange,
}: {
  action: PresentationAction | null;
  versionNumber: number;
  publishedAtLabel: string;
  pending: boolean;
  serverError: { message: string; reload: boolean } | null;
  fieldErrors: ResponseFieldErrors;
  onFieldEdit: (field: keyof ResponseFieldErrors) => void;
  onSubmit: (values: ResponseDialogValues) => void;
  onReload: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const copy = action ? COPY[action] : null;
  const nameRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const messageRef = React.useRef<HTMLTextAreaElement>(null);

  // Move focus to the first invalid field so screen readers announce the error via aria-describedby.
  // Only on the empty → non-empty transition (a fresh server response), so clearing one field's
  // error while the visitor keeps typing in another field doesn't steal focus mid-keystroke.
  const wasEmptyRef = React.useRef(true);
  React.useEffect(() => {
    const isEmpty = Object.keys(fieldErrors).length === 0;
    if (!isEmpty && wasEmptyRef.current) {
      if (fieldErrors.name) {
        nameRef.current?.focus();
      } else if (fieldErrors.email) {
        emailRef.current?.focus();
      } else if (fieldErrors.message) {
        messageRef.current?.focus();
      }
    }
    wasEmptyRef.current = isEmpty;
  }, [fieldErrors]);

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
            <Input
              ref={nameRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                onFieldEdit("name");
              }}
              autoComplete="name"
              maxLength={120}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? "response-name-error" : undefined}
            />
          </label>
          {fieldErrors.name ? (
            <p id="response-name-error" className="text-xs text-error">
              {fieldErrors.name}
            </p>
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            E-mail
            <Input
              ref={emailRef}
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                onFieldEdit("email");
              }}
              autoComplete="email"
              maxLength={254}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? "response-email-error" : undefined}
            />
          </label>
          {fieldErrors.email ? (
            <p id="response-email-error" className="text-xs text-error">
              {fieldErrors.email}
            </p>
          ) : null}
          {copy?.messageLabel ? (
            <>
              <label className="flex flex-col gap-1 text-sm">
                {copy.messageLabel}
                <Textarea
                  ref={messageRef}
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value);
                    onFieldEdit("message");
                  }}
                  rows={4}
                  maxLength={2000}
                  aria-invalid={fieldErrors.message ? true : undefined}
                  aria-describedby={fieldErrors.message ? "response-message-error" : undefined}
                />
              </label>
              {fieldErrors.message ? (
                <p id="response-message-error" className="text-xs text-error">
                  {fieldErrors.message}
                </p>
              ) : null}
            </>
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
