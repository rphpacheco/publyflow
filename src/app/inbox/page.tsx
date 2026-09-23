"use client";

import * as React from "react";
import { Inbox as InboxIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getDevOrganizationId } from "@/lib/organization";
import { useCreatorContext } from "@/components/shell/creator-context";
import {
  useCommercialInquiries,
  commercialInquiriesQueryKey,
  type CommercialInquiryListItem,
  type InquiryStatus,
} from "@/hooks/use-commercial-inquiries";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InquiryList } from "@/components/inbox/inquiry-list";
import { InquirySidePanel } from "@/components/inbox/inquiry-side-panel";
import { NewMessageSheet } from "@/components/inbox/new-message-sheet";
import { useInboxShortcuts } from "@/components/inbox/use-inbox-shortcuts";

const TABS: { value: InquiryStatus; label: string }[] = [
  { value: "NEW", label: "Novas" },
  { value: "CONVERTED", label: "Convertidas" },
  { value: "DISCARDED", label: "Descartadas" },
  { value: "FALSE_POSITIVE", label: "Falsos Positivos" },
];

export default function InboxPage() {
  const organizationId = getDevOrganizationId();
  const { selectedCreatorId } = useCreatorContext();
  const [activeTab, setActiveTab] = React.useState<InquiryStatus>("NEW");
  const [selectedInquiry, setSelectedInquiry] = React.useState<CommercialInquiryListItem | null>(
    null,
  );
  const [newMessageOpen, setNewMessageOpen] = React.useState(false);
  const queryClient = useQueryClient();

  const { data: inquiries, isLoading } = useCommercialInquiries(
    organizationId,
    selectedCreatorId ?? "",
    activeTab,
    { enabled: selectedCreatorId !== null },
  );

  const sidePanelActionsRef = React.useRef<{
    convert: () => void;
    discard: () => void;
    markFalsePositive: () => void;
  } | null>(null);

  useInboxShortcuts({
    inquiries: inquiries ?? [],
    selectedId: selectedInquiry?.id ?? null,
    onSelect: setSelectedInquiry,
    onConvert: () => sidePanelActionsRef.current?.convert(),
    onDiscard: () => sidePanelActionsRef.current?.discard(),
    onMarkFalsePositive: () => sidePanelActionsRef.current?.markFalsePositive(),
    onClose: () => setSelectedInquiry(null),
  });

  if (!selectedCreatorId) {
    return (
      <EmptyState
        icon={InboxIcon}
        title="Selecione um creator"
        description="Escolha um creator no seletor do header para ver o Inbox."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inbox</h1>
        <Button onClick={() => setNewMessageOpen(true)}>Nova Mensagem</Button>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setActiveTab(tab.value);
              setSelectedInquiry(null);
            }}
            className={
              tab.value === activeTab
                ? "border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary"
                : "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : !inquiries || inquiries.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title={activeTab === "NEW" ? "Nenhuma mensagem nova" : "Nada por aqui"}
          description={
            activeTab === "NEW" ? "Novas mensagens comerciais aparecem aqui." : undefined
          }
          action={
            activeTab === "NEW" ? (
              <Button onClick={() => setNewMessageOpen(true)}>Nova Mensagem</Button>
            ) : undefined
          }
        />
      ) : (
        <InquiryList
          inquiries={inquiries}
          selectedId={selectedInquiry?.id ?? null}
          onSelect={setSelectedInquiry}
        />
      )}

      <InquirySidePanel
        inquiry={selectedInquiry}
        open={selectedInquiry !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedInquiry(null);
        }}
        organizationId={organizationId}
        creatorId={selectedCreatorId}
        status={activeTab}
        registerActions={(actions) => {
          sidePanelActionsRef.current = actions;
        }}
      />

      <NewMessageSheet
        open={newMessageOpen}
        onOpenChange={setNewMessageOpen}
        organizationId={organizationId}
        creatorId={selectedCreatorId}
        onSent={() => {
          setNewMessageOpen(false);
          queryClient.invalidateQueries({
            queryKey: commercialInquiriesQueryKey(organizationId, selectedCreatorId, "NEW"),
          });
        }}
      />
    </div>
  );
}
