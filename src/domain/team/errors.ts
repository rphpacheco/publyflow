export type TeamConflictCode =
  | "ALREADY_IN_TEAM"
  | "IS_CREATOR"
  | "OTHER_ORGANIZATION"
  | "NOT_A_MANAGER"
  | "CANNOT_REMOVE_OWNER"
  | "CANNOT_REMOVE_SELF";

export const TEAM_ERRORS: Record<TeamConflictCode, string> = {
  ALREADY_IN_TEAM: "Essa pessoa já faz parte da equipe.",
  IS_CREATOR: "Esse e-mail é de um creator desta organização.",
  OTHER_ORGANIZATION: "Esse e-mail já tem acesso a outra organização.",
  NOT_A_MANAGER: "Só é possível reenviar o acesso de um gestor.",
  CANNOT_REMOVE_OWNER: "Não é possível remover um proprietário.",
  CANNOT_REMOVE_SELF: "Você não pode remover o próprio acesso.",
};

export class TeamConflictError extends Error {
  constructor(public readonly code: TeamConflictCode) {
    super(TEAM_ERRORS[code]);
    this.name = "TeamConflictError";
  }
}

export class TeamMemberNotFoundError extends Error {
  constructor() {
    super("Membro não encontrado.");
    this.name = "TeamMemberNotFoundError";
  }
}
