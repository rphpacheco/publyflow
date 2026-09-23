export type OpportunityStage =
  | "NOVO_LEAD"
  | "QUALIFICACAO"
  | "PRIMEIRO_CONTATO"
  | "MIDIA_KIT_ENVIADO"
  | "PROPOSTA_SOLICITADA"
  | "PROPOSTA_ENVIADA"
  | "NEGOCIACAO"
  | "AGUARDANDO_CLIENTE"
  | "FECHADO"
  | "PERDIDO";

export const STAGES: OpportunityStage[] = [
  "NOVO_LEAD",
  "QUALIFICACAO",
  "PRIMEIRO_CONTATO",
  "MIDIA_KIT_ENVIADO",
  "PROPOSTA_SOLICITADA",
  "PROPOSTA_ENVIADA",
  "NEGOCIACAO",
  "AGUARDANDO_CLIENTE",
  "FECHADO",
  "PERDIDO",
];

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  NOVO_LEAD: "Novo Lead",
  QUALIFICACAO: "Qualificação",
  PRIMEIRO_CONTATO: "Primeiro Contato",
  MIDIA_KIT_ENVIADO: "Mídia Kit Enviado",
  PROPOSTA_SOLICITADA: "Proposta Solicitada",
  PROPOSTA_ENVIADA: "Proposta Enviada",
  NEGOCIACAO: "Negociação",
  AGUARDANDO_CLIENTE: "Aguardando Cliente",
  FECHADO: "Fechado",
  PERDIDO: "Perdido",
};
