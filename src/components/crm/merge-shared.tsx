import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function MergeWarning({ children }: { children: React.ReactNode }) {
  return (
    <div role="note" className="flex min-w-0 items-start gap-2 rounded-md bg-error/10 p-3 text-sm text-error">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 break-words">{children}</p>
    </div>
  );
}

export function PreviewError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted-foreground">Não foi possível carregar a prévia</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}

export function isSameRecordError(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.body as { code?: string } | null)?.code === "SAME_RECORD";
}
