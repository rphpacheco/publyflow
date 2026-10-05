import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrencyBRL } from "@/lib/format";
import type { DashboardMetricsDto } from "@/hooks/use-dashboard";

export function CreatorsTable({ creators }: { creators: DashboardMetricsDto["creators"] }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-medium">Creators</h2>
      {creators.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum creator cadastrado.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Creator</TableHead>
              <TableHead>Oport. abertas</TableHead>
              <TableHead>Propostas enviadas</TableHead>
              <TableHead>Fechadas</TableHead>
              <TableHead>Aprovação (cliente)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {creators.map((c) => (
              <TableRow key={c.creatorId}>
                <TableCell>{c.name}</TableCell>
                <TableCell>{c.openOpportunities}</TableCell>
                <TableCell>{c.proposalsSent}</TableCell>
                <TableCell>{c.wonCount} · {formatCurrencyBRL(c.wonCents)}</TableCell>
                <TableCell>{c.approvalRate === null ? "—" : `${Math.round(c.approvalRate * 100)}%`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
