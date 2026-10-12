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
          Este link expirou ou já foi usado. Peça um novo link. Se o link já foi aberto (por exemplo, por um verificador de e-mail), peça um novo.
        </p>
      ) : null}
      <ForgotPasswordForm />
    </main>
  );
}
