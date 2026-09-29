"use client";

import * as React from "react";
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
import { ApiError } from "@/lib/api-client";
import { useInviteCreator, useRemindCreatorAccess, useRevokeCreatorAccess } from "@/hooks/use-creators";

type AccessCreator = {
  id: string;
  displayName: string;
  email: string;
  access: "none" | "invited" | "active" | "team";
};

export function CreatorAccessActions({
  creator,
  onInstructions,
}: {
  creator: AccessCreator;
  onInstructions: (args: { email: string; message: string }) => void;
}) {
  const invite = useInviteCreator();
  const remind = useRemindCreatorAccess();
  const revoke = useRevokeCreatorAccess();
  const [confirm, setConfirm] = React.useState<"invite" | "revoke" | null>(null);
  const busy = invite.isPending || remind.isPending || revoke.isPending;

  async function doInvite() {
    setConfirm(null);
    try {
      const result = await invite.mutateAsync({ creatorId: creator.id });
      toast.success("Convite criado.");
      onInstructions({ email: creator.email, message: result.message });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não foi possível convidar. Tente novamente.");
    }
  }

  async function doRemind() {
    try {
      const result = await remind.mutateAsync({ creatorId: creator.id });
      onInstructions({ email: creator.email, message: result.message });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não foi possível reenviar. Tente novamente.");
    }
  }

  async function doRevoke() {
    setConfirm(null);
    try {
      await revoke.mutateAsync({ creatorId: creator.id });
      toast.success("Acesso revogado.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não foi possível revogar. Tente novamente.");
    }
  }

  if (creator.access === "team") return null;

  return (
    <div className="flex items-center gap-2">
      {creator.access === "none" ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirm("invite")}>
          Convidar
        </Button>
      ) : (
        <>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={doRemind}>
            Reenviar instruções
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirm("revoke")}>
            Revogar acesso
          </Button>
        </>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "invite" ? "Convidar creator" : "Revogar acesso"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "invite"
                ? `${creator.displayName} poderá entrar no PublyFlow e ver as próprias demandas, oportunidades e propostas.`
                : `${creator.displayName} perderá o acesso imediatamente.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant={confirm === "revoke" ? "destructive" : "default"}
                disabled={busy}
                onClick={confirm === "invite" ? doInvite : doRevoke}
              >
                {confirm === "invite" ? "Convidar" : "Revogar acesso"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
