"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function AccessInstructionsDialog({
  open,
  onOpenChange,
  email,
  message,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  message: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Mensagem copiada.");
    } catch {
      toast.error("Não foi possível copiar a mensagem.");
    }
  }
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Acesso ao PublyFlow")}&body=${encodeURIComponent(message)}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Instruções de acesso</DialogTitle>
        </DialogHeader>
        <Textarea readOnly value={message} rows={5} aria-label="Mensagem de acesso" />
        <div className="flex gap-2">
          <Button type="button" onClick={copy}>
            Copiar mensagem
          </Button>
          <Button asChild variant="outline">
            <a href={mailto}>E-mail</a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
