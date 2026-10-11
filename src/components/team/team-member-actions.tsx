"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/api-client";
import { useRemindManager, useRemoveManager, type TeamMemberDto } from "@/hooks/use-team";

export function TeamMemberActions({
  member,
  onInstructions,
}: {
  member: TeamMemberDto;
  onInstructions: (args: { email: string; message: string }) => void;
}) {
  const remind = useRemindManager();
  const remove = useRemoveManager();
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const busy = remind.isPending || remove.isPending;

  async function doRemind() {
    try {
      const result = await remind.mutateAsync({ memberId: member.id });
      onInstructions({ email: member.email, message: result.message });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não foi possível reenviar. Tente novamente.");
    }
  }

  async function doRemove() {
    setConfirmRemove(false);
    try {
      await remove.mutateAsync({ memberId: member.id });
      toast.success("Acesso removido.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não foi possível remover. Tente novamente.");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`Ações de ${member.fullName}`}>
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={doRemind}>Reenviar acesso</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirmRemove(true)}>Remover acesso</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover acesso</AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              {`Remover o acesso de ${member.fullName}? A pessoa perde o acesso imediatamente.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" disabled={busy} onClick={doRemove}>
                Remover
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
