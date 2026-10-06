import { redirect } from "next/navigation";
import { getAuthState, type AuthState } from "@/lib/auth/session";
import { AuthUnavailableError } from "@/lib/auth/errors";
import { SessionUnavailable } from "@/components/auth/session-unavailable";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  let state: AuthState;
  try {
    state = await getAuthState();
  } catch (e) {
    if (e instanceof AuthUnavailableError) return <SessionUnavailable />;
    throw e;
  }
  if (state.status === "member") redirect("/pipeline");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold">Entrar no PublyFlow</h1>
      {state.status === "no-access" ? (
        <div role="status" className="flex w-full max-w-sm flex-col items-center gap-3 rounded-md border border-border p-4 text-center">
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            Você está conectado como {state.email ?? "outra conta"}, mas essa conta não tem acesso ao PublyFlow.
          </p>
          <SignOutButton label="Sair e entrar com outra conta" />
        </div>
      ) : null}
      <LoginForm oauthError={error === "oauth"} />
    </main>
  );
}
