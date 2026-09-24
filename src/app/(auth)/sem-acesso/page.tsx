import Link from "next/link";

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Sua conta ainda não tem acesso</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Este e-mail não está cadastrado em nenhuma organização do PublyFlow. Peça para o
        responsável pela sua organização liberar seu acesso.
      </p>
      <Link href="/login" className="text-sm font-medium text-primary">
        Voltar ao login
      </Link>
    </main>
  );
}
