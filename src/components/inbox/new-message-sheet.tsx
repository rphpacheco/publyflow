"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSendInboxMessage } from "@/hooks/use-send-inbox-message";

export interface NewMessageSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  creatorId: string;
  onSent: () => void;
}

const CHANNEL_LABELS = {
  INSTAGRAM: "Instagram",
  WHATSAPP: "WhatsApp",
  TIKTOK: "TikTok",
} as const;

export function NewMessageSheet({
  open,
  onOpenChange,
  organizationId,
  creatorId,
  onSent,
}: NewMessageSheetProps) {
  const [source, setSource] = React.useState<"INSTAGRAM" | "WHATSAPP" | "TIKTOK">("INSTAGRAM");
  const [externalContactLabel, setExternalContactLabel] = React.useState("");
  const [body, setBody] = React.useState("");
  const sendMessage = useSendInboxMessage();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    sendMessage.mutate(
      { organizationId, creatorId, source, externalContactLabel, body },
      {
        onSuccess: () => {
          toast.success("Mensagem enviada");
          setExternalContactLabel("");
          setBody("");
          setSource("INSTAGRAM");
          onSent();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Nova Mensagem</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="new-message-channel">
              Canal
            </label>
            <Select value={source} onValueChange={(value) => setSource(value as typeof source)}>
              <SelectTrigger id="new-message-channel" aria-label="Canal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="new-message-sender">
              Remetente
            </label>
            <Input
              id="new-message-sender"
              value={externalContactLabel}
              onChange={(event) => setExternalContactLabel(event.target.value)}
              placeholder="Maria — Bella Cosméticos"
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="new-message-body">
              Mensagem
            </label>
            <Textarea
              id="new-message-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Cole ou digite a mensagem recebida..."
              required
            />
          </div>

          <Button type="submit" disabled={sendMessage.isPending}>
            Enviar
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
