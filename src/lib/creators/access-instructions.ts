export function buildAccessInstructions(input: {
  displayName: string;
  email: string;
  origin: string;
}): { loginUrl: string; message: string } {
  const loginUrl = `${input.origin}/login`;
  return {
    loginUrl,
    message: `Olá, ${input.displayName}! Você foi convidado(a) para acompanhar suas propostas no PublyFlow. Acesse ${loginUrl} e entre com Google ou com um link enviado para ${input.email}.`,
  };
}
