import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SessionUnavailable } from "@/components/auth/session-unavailable";
import { cn } from "@/lib/utils";
import { hasValidResetGrant } from "./grant-check";
import { ResetPasswordForm } from "./reset-password-form";

// Reads the session and the grant cookie on every request.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const check = await hasValidResetGrant();
  if (check === "unavailable") return <SessionUnavailable />;

  if (check === "expired") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p role="alert" className="max-w-sm text-sm text-muted-foreground">
          Este link expirou ou já foi usado. Peça um novo link.
        </p>
        <Link href="/forgot-password" className={cn(buttonVariants({ variant: "outline" }))}>
          Pedir novo link
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold">Definir nova senha</h1>
      <ResetPasswordForm />
    </main>
  );
}
