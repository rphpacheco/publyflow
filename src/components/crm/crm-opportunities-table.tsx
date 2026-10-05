import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProposalStatusBadge } from "@/components/proposals/proposal-status-badge";
import { STAGE_LABELS } from "@/lib/opportunity-stages";
import { formatCurrencyBRL } from "@/lib/format";
import type { CrmOpportunityDto } from "@/hooks/use-crm";

const STATUS_LABEL: Record<CrmOpportunityDto["status"], string> = { OPEN: "Aberta", WON: "Ganha", LOST: "Perdida" };

export function CrmOpportunitiesTable({ opportunities }: { opportunities: CrmOpportunityDto[] }) {
  if (opportunities.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma oportunidade.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Brand</TableHead>
          <TableHead>Creator</TableHead>
          <TableHead>Estágio</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Valor estimado</TableHead>
          <TableHead>Propostas</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {opportunities.map((opportunity) => (
          <TableRow key={opportunity.id}>
            <TableCell>{opportunity.brandName ?? "—"}</TableCell>
            <TableCell>{opportunity.creatorName}</TableCell>
            <TableCell>{STAGE_LABELS[opportunity.stage]}</TableCell>
            <TableCell>
              <Badge>{STATUS_LABEL[opportunity.status]}</Badge>
            </TableCell>
            <TableCell>{opportunity.estimatedValueCents === null ? "—" : formatCurrencyBRL(opportunity.estimatedValueCents)}</TableCell>
            <TableCell>
              {opportunity.proposals.length === 0 ? (
                "—"
              ) : (
                <ul className="flex flex-col gap-1">
                  {opportunity.proposals.map((proposal) => (
                    <li key={proposal.id} className="flex items-center gap-2">
                      <Link href={`/proposals/${proposal.id}`} className="underline-offset-2 hover:underline">
                        {proposal.title}
                      </Link>
                      <ProposalStatusBadge status={proposal.status} />
                    </li>
                  ))}
                </ul>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
