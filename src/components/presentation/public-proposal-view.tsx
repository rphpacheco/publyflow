"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { PresentationAction, PresentationModel, PresentationResponse } from "@/lib/presentation/types";
import { PresentationRenderer } from "./presentation-renderer";
import { ResponseDialog, type ResponseDialogValues, type ResponseFieldErrors } from "./response-dialog";

const API_ACTION: Record<PresentationAction, "ACCEPT" | "REQUEST_CHANGES" | "REJECT"> = {
  accept: "ACCEPT",
  request_changes: "REQUEST_CHANGES",
  reject: "REJECT",
};

export interface PublicProposalViewProps {
  token: string;
  model: PresentationModel;
  publicationId: string;
  versionNumber: number;
  publishedAtLabel: string;
  response: PresentationResponse | null;
}

/** Client wrapper for the public page: wires the renderer's actions to the response dialog. */
export function PublicProposalView({ token, model, publicationId, versionNumber, publishedAtLabel, response }: PublicProposalViewProps) {
  const router = useRouter();
  const [action, setAction] = React.useState<PresentationAction | null>(null);
  const [pending, setPending] = React.useState(false);
  const [serverError, setServerError] = React.useState<{ message: string; reload: boolean } | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<ResponseFieldErrors>({});

  async function submit(values: ResponseDialogValues) {
    if (!action) return;
    setPending(true);
    setServerError(null);
    setFieldErrors({});
    try {
      const result = await fetch(`/api/public/proposals/${token}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicationId, action: API_ACTION[action], ...values }),
      });
      if (result.ok) {
        setAction(null);
        router.refresh();
        return;
      }
      const body = (await result.json().catch(() => ({}))) as { code?: string; errors?: Record<string, string[] | undefined> };
      if (result.status === 409 && body.code === "ALREADY_RESPONDED") {
        setAction(null);
        router.refresh();
      } else if (result.status === 409) {
        setServerError({ message: "Esta proposta foi atualizada. Recarregue para ver a versão atual.", reload: true });
      } else if (result.status === 410 || result.status === 404) {
        setServerError({ message: "Esta proposta não está mais disponível.", reload: true });
      } else if (result.status === 429) {
        setServerError({ message: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.", reload: false });
      } else if (result.status === 400) {
        const visible: ResponseFieldErrors = {};
        for (const field of ["name", "email", "message"] as const) {
          const first = body.errors?.[field]?.[0];
          if (first) visible[field] = first;
        }
        if (Object.keys(visible).length > 0) {
          setFieldErrors(visible);
        } else {
          setServerError({ message: "Confira os dados informados.", reload: false });
        }
      } else {
        setServerError({ message: "Não foi possível registrar sua resposta. Tente novamente.", reload: false });
      }
    } catch {
      setServerError({ message: "Não foi possível registrar sua resposta. Tente novamente.", reload: false });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PresentationRenderer
        model={model}
        className="min-h-dvh"
        response={response ?? undefined}
        onAction={response ? undefined : (next) => {
          setServerError(null);
          setFieldErrors({});
          setAction(next);
        }}
      />
      <ResponseDialog
        key={action ?? "closed"}
        action={action}
        versionNumber={versionNumber}
        publishedAtLabel={publishedAtLabel}
        pending={pending}
        serverError={serverError}
        fieldErrors={fieldErrors}
        onFieldEdit={(field) => setFieldErrors(({ [field]: _removed, ...rest }) => rest)}
        onSubmit={submit}
        onReload={() => {
          setAction(null);
          router.refresh();
        }}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null);
            setFieldErrors({});
          }
        }}
      />
    </>
  );
}
