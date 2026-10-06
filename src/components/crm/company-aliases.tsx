"use client";

import * as React from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRemoveCompanyAlias } from "@/hooks/use-crm-merge";
import { ApiError } from "@/lib/api-client";

export function CompanyAliases({ companyId, aliases }: { companyId: string; aliases: Array<{ id: string; name: string }> }) {
  const remove = useRemoveCompanyAlias(companyId);
  const [target, setTarget] = React.useState<{ id: string; name: string } | null>(null);

  if (aliases.length === 0) return null;

  async function confirmRemove() {
    if (!target) return;
    const { id } = target;
    setTarget(null);
    try {
      await remove.mutateAsync({ aliasId: id });
      toast.success("Apelido removido.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não foi possível remover o apelido.");
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-sm font-medium">Apelidos</h2>
      <p className="text-sm text-muted-foreground">Nomes que a IA do Inbox reconhece como esta empresa.</p>
      <ul className="flex flex-wrap gap-2">
        {aliases.map((alias) => (
          <li key={alias.id} className="flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border py-0.5 pl-3 pr-1 text-sm">
            <span className="min-w-0 break-words">{alias.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label={`Remover apelido ${alias.name}`}
              onClick={() => setTarget(alias)}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>

      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="min-w-0 break-words">Remover o apelido {target?.name}?</AlertDialogTitle>
            <AlertDialogDescription>A IA do Inbox deixa de reconhecer esse nome como esta empresa.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-wrap">
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button type="button" variant="destructive" onClick={() => void confirmRemove()}>
                Remover
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
