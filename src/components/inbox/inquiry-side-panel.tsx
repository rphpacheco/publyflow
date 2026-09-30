"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import type { InquiryStatus } from "@/hooks/use-commercial-inquiries";
import {
  useConvertInquiry,
  useDiscardInquiry,
  useMarkFalsePositiveInquiry,
  useUpdateInquiryGuesses,
} from "@/hooks/use-inquiry-mutations";
import { ApiError } from "@/lib/api-client";
import { InquiryEditForm } from "./inquiry-edit-form";

export interface InquirySidePanelProps {
  inquiry: CommercialInquiryListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creatorId: string;
  status: InquiryStatus;
  registerActions?: (actions: {
    convert: () => void;
    discard: () => void;
    markFalsePositive: () => void;
  }) => void;
  readOnly?: boolean;
}

export function InquirySidePanel({
  inquiry,
  open,
  onOpenChange,
  creatorId,
  status,
  registerActions,
  readOnly = false,
}: InquirySidePanelProps) {
  const convert = useConvertInquiry(creatorId, status);
  const discard = useDiscardInquiry(creatorId, status);
  const markFalsePositive = useMarkFalsePositiveInquiry(creatorId, status);
  const updateGuesses = useUpdateInquiryGuesses(creatorId, status);
  const dadosHeadingId = React.useId();

  const [editMode, setEditMode] = React.useState(false);
  const [editingData, setEditingData] = React.useState(false);
  const [overrides, setOverrides] = React.useState<Pick<
    CommercialInquiryListItem,
    "contactNameGuess" | "companyGuess" | "brandGuess"
  > | null>(null);

  React.useEffect(() => {
    setEditMode(false);
    setEditingData(false);
    setOverrides(null);
  }, [inquiry?.id]);

  // F1: the effect below registers the shortcut actions once per
  // inquiry (deps: [inquiry?.id, readOnly]), so the closures it captures
  // on that render must stay live for the whole time this inquiry is
  // selected -- including after "Editar dados" applies an override. A
  // ref updated on every render, read from inside thin wrapper
  // functions, gives the registered actions access to the latest
  // handlers without re-registering (and re-running) on every render.
  const handlersRef = React.useRef({ handleConvert, handleDiscard, handleMarkFalsePositive });
  React.useEffect(() => {
    handlersRef.current = { handleConvert, handleDiscard, handleMarkFalsePositive };
  });

  React.useEffect(() => {
    if (readOnly) return;
    registerActions?.({
      convert: () => handlersRef.current.handleConvert(),
      discard: () => handlersRef.current.handleDiscard(),
      markFalsePositive: () => handlersRef.current.handleMarkFalsePositive(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquiry?.id, readOnly]);

  if (!inquiry) return null;

  const current = { ...inquiry, ...(overrides ?? {}) };

  function handleConvert() {
    convert.mutate(
      {
        inquiryId: current.id,
        contact: { fullName: current.contactNameGuess ?? current.externalContactLabel ?? "Desconhecido" },
      },
      {
        onSuccess: () => {
          toast.success("Convertida em Opportunity");
          onOpenChange(false);
        },
        onError: (error) => {
          const code = error instanceof ApiError ? (error.body as { code?: string } | null)?.code : undefined;
          if (code === "PARTY_REQUIRED") {
            toast.error(error.message);
            // F7: only one edit UI on screen at a time -- opening the
            // Dados inputs must close the select-existing form if it was
            // somehow left open.
            setEditMode(false);
            setEditingData(true);
            return;
          }
          if (code === "AMBIGUOUS_PARTY") {
            toast.error(error.message);
            // F7: same guarantee in the other direction.
            setEditingData(false);
            setEditMode(true);
            return;
          }
          toast.error(error.message);
        },
      },
    );
  }

  function handleEditConfirm(input: {
    contact: { id: string } | { fullName: string };
    companyId: string | null;
    brandId: string | null;
  }) {
    convert.mutate(
      { inquiryId: current.id, contact: input.contact, companyId: input.companyId, brandId: input.brandId },
      {
        onSuccess: () => {
          toast.success("Convertida em Opportunity");
          setEditMode(false);
          onOpenChange(false);
        },
        onError: (error) => {
          // F5: AMBIGUOUS_PARTY keeps the actionable fixed copy below
          // (the user is already looking at the company/brand fields
          // that caused it); any other failure (e.g. a 409 because the
          // inquiry was resolved concurrently) must surface its own
          // message instead of the generic one, which would otherwise
          // hide the real reason (e.g. "Esta mensagem já foi resolvida.").
          const code = error instanceof ApiError ? (error.body as { code?: string } | null)?.code : undefined;
          if (code === "AMBIGUOUS_PARTY") {
            toast.error("Ainda não foi possível resolver — revise a seleção de empresa e marca abaixo.");
            return;
          }
          toast.error(error.message);
        },
      },
    );
  }

  function handleDiscard() {
    discard.mutate(current.id, {
      onSuccess: () => {
        toast.success("Descartada");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function handleMarkFalsePositive() {
    markFalsePositive.mutate(current.id, {
      onSuccess: () => {
        toast.success("Marcada como falso positivo");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // F7: the select-existing form (editMode) and the Dados block are two
  // separate ways to fix up the same company/brand/contact data -- having
  // both on screen at once is confusing and lets them drift out of sync.
  const showDados = !readOnly && current.status === "NEW" && !editMode;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{current.externalContactLabel}</SheetTitle>
          <SheetDescription>{current.messageBody}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 text-sm">
          {!showDados && current.companyGuess ? (
            <p>
              <span className="text-muted-foreground">Empresa (IA): </span>
              {current.companyGuess}
            </p>
          ) : null}
          {!showDados && current.brandGuess ? (
            <p>
              <span className="text-muted-foreground">Marca (IA): </span>
              {current.brandGuess}
            </p>
          ) : null}
          {current.budgetGuess ? (
            <p>
              <span className="text-muted-foreground">Orçamento (IA): </span>
              {current.budgetGuess}
            </p>
          ) : null}
          {current.intentGuess ? (
            <p>
              <span className="text-muted-foreground">Intenção (IA): </span>
              {current.intentGuess}
            </p>
          ) : null}
        </div>

        {showDados ? (
          <section aria-labelledby={dadosHeadingId} className="mt-4 flex flex-col gap-2 text-sm">
            <h3 id={dadosHeadingId} className="text-xs font-semibold uppercase text-muted-foreground">
              Dados
            </h3>
            {editingData ? (
              <InquiryDataForm
                initial={current}
                pending={updateGuesses.isPending}
                onCancel={() => setEditingData(false)}
                onSave={(values) =>
                  updateGuesses.mutate(
                    { inquiryId: current.id, ...values },
                    {
                      onSuccess: (updated) => {
                        setOverrides({
                          contactNameGuess: updated.contactNameGuess,
                          companyGuess: updated.companyGuess,
                          brandGuess: updated.brandGuess,
                        });
                        setEditingData(false);
                        toast.success("Dados atualizados.");
                      },
                      onError: (error) => toast.error(error.message),
                    },
                  )
                }
              />
            ) : (
              <>
                <p>
                  <span className="text-muted-foreground">Contato: </span>
                  {current.contactNameGuess ?? "—"}
                </p>
                <p>
                  <span className="text-muted-foreground">Empresa: </span>
                  {current.companyGuess ?? "—"}
                </p>
                <p>
                  <span className="text-muted-foreground">Marca: </span>
                  {current.brandGuess ?? "—"}
                </p>
                <div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditingData(true)}>
                    Editar dados
                  </Button>
                </div>
              </>
            )}
          </section>
        ) : null}

        {readOnly ? null : editMode ? (
          <InquiryEditForm
            initialCompanyName={current.companyGuess}
            initialContactName={current.contactNameGuess}
            onConfirm={handleEditConfirm}
          />
        ) : (
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={handleConvert} disabled={convert.isPending}>
              Converter em Opportunity
            </Button>
            <Button variant="outline" onClick={handleDiscard} disabled={discard.isPending}>
              Descartar
            </Button>
            <Button
              variant="ghost"
              onClick={handleMarkFalsePositive}
              disabled={markFalsePositive.isPending}
            >
              Falso Positivo
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InquiryDataForm({
  initial,
  pending,
  onCancel,
  onSave,
}: {
  initial: { contactNameGuess: string | null; companyGuess: string | null; brandGuess: string | null };
  pending: boolean;
  onCancel: () => void;
  onSave: (values: { contactName: string | null; companyName: string | null; brandName: string | null }) => void;
}) {
  const [contactName, setContactName] = React.useState(initial.contactNameGuess ?? "");
  const [companyName, setCompanyName] = React.useState(initial.companyGuess ?? "");
  const [brandName, setBrandName] = React.useState(initial.brandGuess ?? "");
  const toValue = (value: string) => (value.trim() === "" ? null : value.trim());
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ contactName: toValue(contactName), companyName: toValue(companyName), brandName: toValue(brandName) });
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Contato
        <Input value={contactName} maxLength={200} onChange={(event) => setContactName(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Empresa
        <Input value={companyName} maxLength={200} onChange={(event) => setCompanyName(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Marca
        <Input value={brandName} maxLength={200} onChange={(event) => setBrandName(event.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          Salvar
        </Button>
      </div>
    </form>
  );
}
