"use client";

import { useRef, useState, useTransition } from "react";
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
  const signOutFormRef = useRef<HTMLFormElement>(null);

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
    <>
      {/* Outside the menu content on purpose: Radix unmounts the content when an
          item is selected, which cancelled the submit of a nested form in real
          browsers (logout did nothing). Selecting "Sair" submits this form. */}
      <form ref={signOutFormRef} action="/auth/signout" method="post" hidden />
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
          <DropdownMenuItem onSelect={() => signOutFormRef.current?.requestSubmit()}>Sair</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
