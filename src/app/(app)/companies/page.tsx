"use client";

import * as React from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsCreator } from "@/components/shell/session-role-context";
import { BrandFormDialog } from "@/components/crm/brand-form-dialog";
import { useBrands, useCompanies, type BrandDto } from "@/hooks/use-crm";
import { matchesSearch } from "@/lib/crm/search";

const dateLabel = (iso: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));

export default function CompaniesPage() {
  const router = useRouter();
  const isCreator = useIsCreator();
  const { data: companies, isLoading, isError, refetch } = useCompanies();
  const { data: brands } = useBrands();
  const [query, setQuery] = React.useState("");
  const [dialog, setDialog] = React.useState<{ brand: BrandDto | null; key: number }>({ brand: null, key: 0 });

  React.useEffect(() => {
    if (isCreator) router.replace("/pipeline");
  }, [isCreator, router]);
  if (isCreator) return null;

  const orphanBrands = (brands ?? []).filter((brand) => brand.companyId === null);
  const visible = (companies ?? []).filter((company) => matchesSearch(query, company.name));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Empresas</h1>
      {orphanBrands.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-md border border-border p-3">
          <h2 className="text-sm font-medium">Brands sem empresa</h2>
          <ul className="flex flex-wrap gap-2">
            {orphanBrands.map((brand) => (
              <li key={brand.id} className="flex items-center gap-2 text-sm">
                {brand.name}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Vincular ${brand.name}`}
                  onClick={() => setDialog((prev) => ({ brand, key: prev.key + 1 }))}
                >
                  Vincular
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">Não foi possível carregar as empresas.</p>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : !companies || companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhuma empresa ainda"
          description="Empresas são criadas ao converter mensagens do Inbox."
          action={
            <Link href="/inbox" className="text-sm underline">
              Ir para o Inbox
            </Link>
          }
        />
      ) : (
        <>
          <Input
            type="search"
            aria-label="Buscar empresa"
            placeholder="Buscar empresa"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-sm"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Brands</TableHead>
                <TableHead>Contatos</TableHead>
                <TableHead>Oportunidades abertas</TableHead>
                <TableHead>Criada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((company) => (
                <TableRow key={company.id} className="cursor-pointer" onClick={() => router.push(`/companies/${company.id}`)}>
                  <TableCell>
                    <Link
                      href={`/companies/${company.id}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {company.name}
                    </Link>
                  </TableCell>
                  <TableCell>{company.brandCount}</TableCell>
                  <TableCell>{company.contactCount}</TableCell>
                  <TableCell>{company.openOpportunityCount}</TableCell>
                  <TableCell>{dateLabel(company.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {visible.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma empresa encontrada.</p> : null}
        </>
      )}
      {dialog.brand ? (
        <BrandFormDialog
          key={dialog.key}
          open
          brand={dialog.brand}
          onOpenChange={(open) => !open && setDialog((prev) => ({ ...prev, brand: null }))}
          onSaved={() => {
            setDialog((prev) => ({ ...prev, brand: null }));
            toast.success("Brand atualizada.");
          }}
        />
      ) : null}
    </div>
  );
}
