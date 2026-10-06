import { SignOutButton } from "@/components/auth/sign-out-button";

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Sua conta ainda não tem acesso</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Este e-mail não está cadastrado em nenhuma organização do PublyFlow. Peça para o
        responsável pela sua organização liberar seu acesso.
      </p>
      <SignOutButton label="Sair e entrar com outra conta" />
    </main>
  );
}
