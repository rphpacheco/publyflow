"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsCreator } from "@/components/shell/session-role-context";
import { CompanyFormDialog } from "@/components/crm/company-form-dialog";
import { BrandFormDialog } from "@/components/crm/brand-form-dialog";
import { CrmOpportunitiesTable } from "@/components/crm/crm-opportunities-table";
import { useCompany } from "@/hooks/use-crm";
import { ApiError } from "@/lib/api-client";

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const router = useRouter();
  const isCreator = useIsCreator();
  const { data, isLoading, error, refetch } = useCompany(id);
  const [editingCompany, setEditingCompany] = React.useState(false);
  const [editingBrand, setEditingBrand] = React.useState<{ id: string; name: string } | null>(null);

  React.useEffect(() => {
    if (isCreator) router.replace("/pipeline");
  }, [isCreator, router]);
  if (isCreator) return null;

  const back = (
    <Link href="/companies" className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Voltar para Empresas">
      <ArrowLeft className="size-4" /> Empresas
    </Link>
  );

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm">Empresa não encontrada.</p>
        {back}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">Não foi possível carregar a empresa.</p>
        <Button type="button" variant="outline" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {back}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{data.company.name}</h1>
        <Button type="button" variant="outline" aria-label="Editar empresa" onClick={() => setEditingCompany(true)}>
          Editar
        </Button>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Brands</h2>
        {data.brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma brand.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.brands.map((brand) => (
              <li key={brand.id} className="flex items-center gap-2 text-sm">
                {brand.name}
                <Button type="button" variant="outline" size="sm" aria-label={`Editar ${brand.name}`} onClick={() => setEditingBrand(brand)}>
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Contatos</h2>
        {data.contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum contato.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Instagram</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <Link href={`/contacts/${contact.id}`}>{contact.fullName}</Link>
                  </TableCell>
                  <TableCell>{contact.email ?? "—"}</TableCell>
                  <TableCell>{contact.phone ?? "—"}</TableCell>
                  <TableCell>{contact.instagramHandle ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Oportunidades</h2>
        <CrmOpportunitiesTable opportunities={data.opportunities} />
      </section>

      {editingCompany ? (
        <CompanyFormDialog
          open
          company={data.company}
          onOpenChange={setEditingCompany}
          onSaved={() => {
            setEditingCompany(false);
            toast.success("Empresa atualizada.");
          }}
        />
      ) : null}
      {editingBrand ? (
        <BrandFormDialog
          open
          brand={{ ...editingBrand, companyId: data.company.id }}
          onOpenChange={(open) => !open && setEditingBrand(null)}
          onSaved={() => {
            setEditingBrand(null);
            toast.success("Brand atualizada.");
          }}
        />
      ) : null}
    </div>
  );
}
