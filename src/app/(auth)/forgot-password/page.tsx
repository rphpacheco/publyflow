import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string | string[] }>;
}) {
  const { expired } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold">Redefinir senha</h1>
      {expired === "1" ? (
        <p role="status" className="max-w-sm text-center text-sm text-muted-foreground">
          Este link expirou ou já foi usado. Peça um novo link e abra-o no mesmo navegador em que você o pediu.
        </p>
      ) : null}
      <ForgotPasswordForm />
    </main>
  );
}
