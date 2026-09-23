"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import type { InquiryStatus } from "@/hooks/use-commercial-inquiries";
import {
  useConvertInquiry,
  useDiscardInquiry,
  useMarkFalsePositiveInquiry,
} from "@/hooks/use-inquiry-mutations";
import { ApiError } from "@/lib/api-client";
import { InquiryEditForm } from "./inquiry-edit-form";

export interface InquirySidePanelProps {
  inquiry: CommercialInquiryListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  creatorId: string;
  status: InquiryStatus;
}

export function InquirySidePanel({
  inquiry,
  open,
  onOpenChange,
  organizationId,
  creatorId,
  status,
}: InquirySidePanelProps) {
  const convert = useConvertInquiry(organizationId, creatorId, status);
  const discard = useDiscardInquiry(organizationId, creatorId, status);
  const markFalsePositive = useMarkFalsePositiveInquiry(organizationId, creatorId, status);

  const [editMode, setEditMode] = React.useState(false);

  React.useEffect(() => {
    setEditMode(false);
  }, [inquiry?.id]);

  if (!inquiry) return null;

  function handleConvert() {
    convert.mutate(
      { inquiryId: inquiry!.id, contact: { fullName: inquiry!.contactNameGuess ?? "Desconhecido" } },
      {
        onSuccess: () => {
          toast.success("Convertida em Opportunity");
          onOpenChange(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 422) {
            toast.error("Mais de uma empresa encontrada com esse nome — selecione a correta.");
            setEditMode(true);
            return;
          }
          toast.error(error.message);
        },
      },
    );
  }

  function handleEditConfirm(input: { contact: { id: string } | { fullName: string }; companyId?: string | null }) {
    convert.mutate(
      { inquiryId: inquiry!.id, contact: input.contact, companyId: input.companyId },
      {
        onSuccess: () => {
          toast.success("Convertida em Opportunity");
          setEditMode(false);
          onOpenChange(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function handleDiscard() {
    discard.mutate(inquiry!.id, {
      onSuccess: () => {
        toast.success("Descartada");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function handleMarkFalsePositive() {
    markFalsePositive.mutate(inquiry!.id, {
      onSuccess: () => {
        toast.success("Marcada como falso positivo");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{inquiry.externalContactLabel}</SheetTitle>
          <SheetDescription>{inquiry.messageBody}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 text-sm">
          {inquiry.companyGuess ? (
            <p>
              <span className="text-muted-foreground">Empresa (IA): </span>
              {inquiry.companyGuess}
            </p>
          ) : null}
          {inquiry.brandGuess ? (
            <p>
              <span className="text-muted-foreground">Marca (IA): </span>
              {inquiry.brandGuess}
            </p>
          ) : null}
          {inquiry.budgetGuess ? (
            <p>
              <span className="text-muted-foreground">Orçamento (IA): </span>
              {inquiry.budgetGuess}
            </p>
          ) : null}
          {inquiry.intentGuess ? (
            <p>
              <span className="text-muted-foreground">Intenção (IA): </span>
              {inquiry.intentGuess}
            </p>
          ) : null}
        </div>

        {editMode ? (
          <InquiryEditForm
            organizationId={organizationId}
            initialCompanyName={inquiry.companyGuess}
            initialContactName={inquiry.contactNameGuess}
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
