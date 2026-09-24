"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { useUpdateProposalBlock } from "@/hooks/use-proposal-blocks";
import type { ProposalBlock } from "@/hooks/use-proposal-blocks";

export interface ProposalCoverSectionProps {
  proposalId: string;
  block: ProposalBlock;
  readOnly: boolean;
}

export function ProposalCoverSection({
  proposalId,
  block,
  readOnly,
}: ProposalCoverSectionProps) {
  const updateBlock = useUpdateProposalBlock(proposalId);
  const initialHeadline = (block.content as { headline?: string })?.headline ?? "";
  const [headline, setHeadline] = React.useState(initialHeadline);

  React.useEffect(() => {
    setHeadline(initialHeadline);
  }, [initialHeadline]);

  function handleBlur() {
    if (headline === initialHeadline) return;
    updateBlock.mutate({ blockId: block.id, content: { headline } });
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="proposal-cover-headline">
        Capa
      </label>
      <Input
        id="proposal-cover-headline"
        aria-label="Capa"
        value={headline}
        onChange={(event) => setHeadline(event.target.value)}
        onBlur={handleBlur}
        disabled={readOnly}
        placeholder="Título da capa"
      />
    </div>
  );
}
