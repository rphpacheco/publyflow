"use client";

import { useState, useTransition } from "react";
import { CircleUser } from "lucide-react";
import { toast } from "sonner";
import { requestPasswordChange } from "@/app/(app)/account-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const GENERIC_ERROR = "Não foi possível enviar o link. Tente novamente.";

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function changePassword() {
    startTransition(async () => {
      try {
        const r = await requestPasswordChange();
        if (r.ok) toast.success(`Enviamos um link para ${r.email}. Abra-o para definir a nova senha.`);
        else toast.error(r.error);
      } catch {
        toast.error(GENERIC_ERROR);
      }
      setOpen(false);
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Conta">
          <CircleUser className="size-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={pending}
          onSelect={(e) => {
            e.preventDefault(); // keep the menu open so the disabled state is visible
            changePassword();
          }}
        >
          Alterar senha
        </DropdownMenuItem>
        <form action="/auth/signout" method="post">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full text-left">
              Sair
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
