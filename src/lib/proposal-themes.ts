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

export type ProposalStatus = "DRAFT" | "ARCHIVED";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho",
  ARCHIVED: "Arquivada",
};
