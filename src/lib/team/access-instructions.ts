export function buildTeamAccessInstructions(input: {
  fullName: string;
  organizationName: string;
  email: string;
  origin: string;
}): { loginUrl: string; message: string } {
  const loginUrl = `${input.origin}/login`;
  return {
    loginUrl,
    message: `Olá, ${input.fullName}! Você foi convidado(a) para a equipe da ${input.organizationName} no PublyFlow. Acesse ${loginUrl} e entre com Google ou com um link enviado para ${input.email}.`,
  };
}
