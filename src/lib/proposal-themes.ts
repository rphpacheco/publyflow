export type ProposalTheme =
  | "PREMIUM"
  | "MINIMAL"
  | "EDITORIAL"
  | "FASHION"
  | "BEAUTY"
  | "CORPORATE";

export const PROPOSAL_THEMES: ProposalTheme[] = [
  "PREMIUM",
  "MINIMAL",
  "EDITORIAL",
  "FASHION",
  "BEAUTY",
  "CORPORATE",
];

export const PROPOSAL_THEME_LABELS: Record<ProposalTheme, string> = {
  PREMIUM: "Premium",
  MINIMAL: "Minimalista",
  EDITORIAL: "Editorial",
  FASHION: "Moda",
  BEAUTY: "Beleza",
  CORPORATE: "Corporativo",
};

export type ProposalStatus = "DRAFT" | "ARCHIVED" | "SENT" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho",
  ARCHIVED: "Arquivada",
  SENT: "Enviada",
  CHANGES_REQUESTED: "Ajustes pedidos",
  APPROVED: "Aceita",
  REJECTED: "Recusada",
};

export const PROPOSAL_STATUS_BADGE_VARIANT: Record<ProposalStatus, "default" | "info" | "warning" | "success" | "error"> = {
  DRAFT: "default",
  ARCHIVED: "default",
  SENT: "info",
  CHANGES_REQUESTED: "warning",
  APPROVED: "success",
  REJECTED: "error",
};

/** Statuses in which the public link shows the latest publication. */
export const PUBLIC_PROPOSAL_STATUSES: ProposalStatus[] = ["SENT", "CHANGES_REQUESTED", "APPROVED", "REJECTED"];
