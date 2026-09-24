export type ProposalTemplate =
  | "PREMIUM"
  | "MINIMAL"
  | "EDITORIAL"
  | "FASHION"
  | "BEAUTY"
  | "CORPORATE";

export const PROPOSAL_TEMPLATES: ProposalTemplate[] = [
  "PREMIUM",
  "MINIMAL",
  "EDITORIAL",
  "FASHION",
  "BEAUTY",
  "CORPORATE",
];

export const PROPOSAL_TEMPLATE_LABELS: Record<ProposalTemplate, string> = {
  PREMIUM: "Premium",
  MINIMAL: "Minimalista",
  EDITORIAL: "Editorial",
  FASHION: "Moda",
  BEAUTY: "Beleza",
  CORPORATE: "Corporativo",
};

export type ProposalStatus = "DRAFT" | "ARCHIVED";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho",
  ARCHIVED: "Arquivada",
};
