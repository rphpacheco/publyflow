import * as React from "react";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";

export interface UseInboxShortcutsOptions {
  inquiries: CommercialInquiryListItem[];
  selectedId: string | null;
  onSelect: (inquiry: CommercialInquiryListItem) => void;
  onConvert: () => void;
  onDiscard: () => void;
  onMarkFalsePositive: () => void;
  onClose: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.getAttribute("role") === "combobox") return true;
  if (target.closest("[cmdk-input]")) return true;
  return false;
}

export function useInboxShortcuts({
  inquiries,
  selectedId,
  onSelect,
  onConvert,
  onDiscard,
  onMarkFalsePositive,
  onClose,
}: UseInboxShortcutsOptions): void {
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // F8: Escape while focus is inside an editable element (an open
      // "Editar dados" input, the select-existing combobox, ...) must let
      // that element handle it (e.g. blur, close a popover) instead of
      // closing the whole side panel out from under the user.
      if (isEditableTarget(event.target)) return;

      if (event.key === "Escape") {
        onClose();
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "j" || key === "k") {
        const currentIndex = inquiries.findIndex((inquiry) => inquiry.id === selectedId);
        const nextIndex = key === "j" ? currentIndex + 1 : currentIndex - 1;
        const next = inquiries[nextIndex];
        if (next) onSelect(next);
        return;
      }

      if (!selectedId) return;

      if (key === "c") onConvert();
      if (key === "d") onDiscard();
      if (key === "f") onMarkFalsePositive();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [inquiries, selectedId, onSelect, onConvert, onDiscard, onMarkFalsePositive, onClose]);
}
