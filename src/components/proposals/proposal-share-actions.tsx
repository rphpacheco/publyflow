"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useProposalShareInfo } from "@/hooks/use-proposal-share-info";
import { buildMailtoUrl, buildShareMessage, buildWhatsAppUrl, normalizeWhatsAppPhone } from "@/lib/share-links";

/** Share without a channel API: nothing is recorded as sent (no delivery confirmation). */
export function ProposalShareActions({ proposalId, publicPath }: { proposalId: string; publicPath: string }) {
  const { data } = useProposalShareInfo(proposalId);
  if (!data) return null;

  const url = typeof window === "undefined" ? publicPath : `${window.location.origin}${publicPath}`;
  const message = buildShareMessage({
    contactName: data.contact?.name ?? null,
    creatorName: data.creatorName,
    proposalTitle: data.proposalTitle,
    url,
  });

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Mensagem copiada.");
    } catch {
      toast.error("Não foi possível copiar a mensagem.");
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm" variant="outline">
        <a
          href={buildWhatsAppUrl(normalizeWhatsAppPhone(data.contact?.phone ?? null), message)}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp
        </a>
      </Button>
      <Button asChild size="sm" variant="outline">
        <a href={buildMailtoUrl(data.contact?.email ?? null, `Proposta: ${data.proposalTitle}`, message)}>E-mail</a>
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={copyMessage}>
        Copiar mensagem
      </Button>
    </div>
  );
}
