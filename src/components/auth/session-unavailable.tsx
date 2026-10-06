"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SessionUnavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p role="alert" className="max-w-sm text-sm text-muted-foreground">
        Não foi possível verificar sua sessão agora. Tente novamente em instantes.
      </p>
      <Button type="button" variant="outline" onClick={() => window.location.reload()}>
        <RefreshCw aria-hidden="true" className="size-4" />
        Tentar novamente
      </Button>
    </main>
  );
}
