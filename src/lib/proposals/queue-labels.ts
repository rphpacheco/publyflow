import type { QueueItemDto, QueueSituationDto } from "@/hooks/use-proposal-queue";

export type QueueViewer = "agency" | "creator";

export interface QueueGroup {
  key: string;
  label: string;
  situations: QueueSituationDto[];
}

const AGENCY_GROUPS: QueueGroup[] = [
  { key: "changes", label: "Ajustes pedidos", situations: ["changes_requested"] },
  { key: "ready", label: "Pronta para enviar", situations: ["ready_to_send"] },
  { key: "awaiting-creator", label: "Aguardando creator", situations: ["awaiting_creator"] },
  { key: "draft", label: "Rascunho", situations: ["draft"] },
  { key: "awaiting-client", label: "Aguardando cliente", situations: ["awaiting_client"] },
  { key: "closed", label: "Fechadas", situations: ["closed"] },
  { key: "archived", label: "Arquivadas", situations: ["archived"] },
];

const CREATOR_GROUPS: QueueGroup[] = [
  { key: "awaiting-creator", label: "Aguardando sua aprovação", situations: ["awaiting_creator"] },
  { key: "changes", label: "Em ajustes", situations: ["changes_requested"] },
  { key: "agency", label: "Com a agência", situations: ["ready_to_send", "draft"] },
  { key: "awaiting-client", label: "Aguardando cliente", situations: ["awaiting_client"] },
  { key: "closed", label: "Fechadas", situations: ["closed"] },
  { key: "archived", label: "Arquivadas", situations: ["archived"] },
];

export function groupsFor(viewer: QueueViewer): QueueGroup[] {
  return viewer === "creator" ? CREATOR_GROUPS : AGENCY_GROUPS;
}

export const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

export function detailLine(item: QueueItemDto, viewer: QueueViewer): string {
  switch (item.situation) {
    case "changes_requested": {
      const changes = item.changes;
      if (!changes) return "Ajustes pedidos";
      const who = changes.by === "creator" && viewer === "creator" ? "Você" : changes.name;
      return `${who} pediu: ${changes.excerpt}`;
    }
    case "ready_to_send":
      return item.approvedByCreator ? `Aprovada por ${item.creatorName}` : `Alterações não enviadas · versão ${item.latestVersionNumber}`;
    case "awaiting_creator":
      return viewer === "creator"
        ? `Versão ${item.latestVersionNumber} aguardando sua aprovação`
        : `Versão ${item.latestVersionNumber} aguardando aprovação`;
    case "draft":
      if (item.approvalStale) return "A proposta mudou depois do pedido de aprovação";
      return item.latestPublication ? `Alterações não enviadas · versão ${item.latestVersionNumber}` : "Ainda não enviada";
    case "awaiting_client":
      return item.latestPublication
        ? `Versão ${item.latestPublication.versionNumber} enviada em ${shortDate(item.latestPublication.publishedAt)}`
        : "Aguardando cliente";
    case "closed":
      if (!item.clientOutcome) return "Fechada";
      return `${item.clientOutcome.action === "ACCEPT" ? "Aceita" : "Recusada"} por ${item.clientOutcome.name} em ${shortDate(item.clientOutcome.at)}`;
    case "archived":
      return "Arquivada";
  }
}
