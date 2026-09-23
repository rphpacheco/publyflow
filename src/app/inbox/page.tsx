"use client";

import * as React from "react";
import { Inbox as InboxIcon } from "lucide-react";
import { getDevOrganizationId } from "@/lib/organization";
import { useCreatorContext } from "@/components/shell/creator-context";
import { useCommercialInquiries, type InquiryStatus } from "@/hooks/use-commercial-inquiries";
import { EmptyState } from "@/components/ui/empty-state";
import { InquiryList } from "@/components/inbox/inquiry-list";

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

  const { data: inquiries, isLoading } = useCommercialInquiries(
    organizationId,
    selectedCreatorId ?? "",
    activeTab,
  );

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
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
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
        />
      ) : (
        <InquiryList inquiries={inquiries} selectedId={null} onSelect={() => {}} />
      )}
    </div>
  );
}
