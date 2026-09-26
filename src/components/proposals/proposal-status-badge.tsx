import { Badge } from "@/components/ui/badge";
import { PROPOSAL_STATUS_BADGE_VARIANT, PROPOSAL_STATUS_LABELS, type ProposalStatus } from "@/lib/proposal-themes";

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  return <Badge variant={PROPOSAL_STATUS_BADGE_VARIANT[status]}>{PROPOSAL_STATUS_LABELS[status]}</Badge>;
}
