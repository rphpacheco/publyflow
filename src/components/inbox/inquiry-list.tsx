"use client";

import { Camera, MessageCircle, Music2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";

// lucide-react has no brand-specific Instagram/WhatsApp/TikTok icons (they
// were removed upstream) -- these are neutral stand-ins, easy to swap
// later without touching any consumer of this map.
const SOURCE_ICON = {
  INSTAGRAM: Camera,
  WHATSAPP: MessageCircle,
  TIKTOK: Music2,
} as const;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.round(hours / 24);
  return `há ${days}d`;
}

export interface InquiryListProps {
  inquiries: CommercialInquiryListItem[];
  selectedId: string | null;
  onSelect: (inquiry: CommercialInquiryListItem) => void;
}

export function InquiryList({ inquiries, selectedId, onSelect }: InquiryListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Remetente</TableHead>
          <TableHead>Empresa/Marca</TableHead>
          <TableHead>Mensagem</TableHead>
          <TableHead>Canal</TableHead>
          <TableHead>Recebido</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {inquiries.map((inquiry) => {
          const SourceIcon = SOURCE_ICON[inquiry.source];
          return (
            <TableRow
              key={inquiry.id}
              onClick={() => onSelect(inquiry)}
              className={cn("cursor-pointer", selectedId === inquiry.id && "bg-primary/10")}
            >
              <TableCell>{inquiry.externalContactLabel}</TableCell>
              <TableCell>{inquiry.companyGuess ?? inquiry.brandGuess ?? "—"}</TableCell>
              <TableCell className="max-w-xs truncate text-muted-foreground">
                {inquiry.messageBody}
              </TableCell>
              <TableCell>
                <SourceIcon className="size-4 text-muted-foreground" />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {relativeTime(inquiry.messageReceivedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
