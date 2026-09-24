"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateProposalBlock } from "@/hooks/use-proposal-blocks";
import type { ProposalBlock } from "@/hooks/use-proposal-blocks";

export interface ProposalTextSectionProps {
  proposalId: string;
  block: ProposalBlock;
  readOnly: boolean;
}

export function ProposalTextSection({
  proposalId,
  block,
  readOnly,
}: ProposalTextSectionProps) {
  const updateBlock = useUpdateProposalBlock(proposalId);
  const initialBody = (block.content as { body?: string })?.body ?? "";
  const [body, setBody] = React.useState(initialBody);

  React.useEffect(() => {
    setBody(initialBody);
  }, [initialBody]);

  function handleBlur() {
    if (body === initialBody) return;
    updateBlock.mutate({ blockId: block.id, content: { body } });
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="proposal-text-body">
        Texto
      </label>
      <Textarea
        id="proposal-text-body"
        aria-label="Texto"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onBlur={handleBlur}
        disabled={readOnly}
        placeholder="Escreva uma mensagem para o cliente..."
        rows={4}
      />
    </div>
  );
}
