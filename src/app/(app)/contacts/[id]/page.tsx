"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Merge } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useIsCreator } from "@/components/shell/session-role-context";
import { ContactFormDialog } from "@/components/crm/contact-form-dialog";
import { MergeContactDialog } from "@/components/crm/merge-contact-dialog";
import { CrmOpportunitiesTable } from "@/components/crm/crm-opportunities-table";
import { useContact } from "@/hooks/use-crm";
import { ApiError } from "@/lib/api-client";

export default function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const router = useRouter();
  const isCreator = useIsCreator();
  const { data, isLoading, error, refetch } = useContact(id);
  const [editing, setEditing] = React.useState(false);
  const [merging, setMerging] = React.useState(false);

  React.useEffect(() => {
    if (isCreator) router.replace("/pipeline");
  }, [isCreator, router]);
  if (isCreator) return null;

  const back = (
    <Link href="/contacts" className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Voltar para Contatos">
      <ArrowLeft className="size-4" /> Contatos
    </Link>
  );

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm">Contato não encontrado.</p>
        {back}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">Não foi possível carregar o contato.</p>
        <Button type="button" variant="outline" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const { contact, company } = data;

  return (
    <div className="flex flex-col gap-6">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="min-w-0 break-words text-lg font-semibold">{contact.fullName}</h1>
          {company ? (
            <Link href={`/companies/${company.id}`} className="text-sm underline">
              {company.name}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">Sem empresa</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" aria-label="Editar contato" onClick={() => setEditing(true)}>
            Editar
          </Button>
          <Button type="button" variant="outline" onClick={() => setMerging(true)}>
            <Merge className="size-4" aria-hidden="true" /> Mesclar em…
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">E-mail</dt>
        <dd>{contact.email ?? "—"}</dd>
        <dt className="text-muted-foreground">Telefone</dt>
        <dd>{contact.phone ?? "—"}</dd>
        <dt className="text-muted-foreground">Instagram</dt>
        <dd>{contact.instagramHandle ?? "—"}</dd>
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Oportunidades</h2>
        <CrmOpportunitiesTable opportunities={data.opportunities} />
      </section>

      {editing ? (
        <ContactFormDialog
          open
          contact={contact}
          onOpenChange={setEditing}
          onSaved={() => {
            setEditing(false);
            toast.success("Contato atualizado.");
          }}
        />
      ) : null}
      {merging ? (
        <MergeContactDialog
          open
          contact={contact}
          onOpenChange={setMerging}
          onMerged={(stays) => {
            setMerging(false);
            toast.success("Contatos mesclados.");
            router.push(`/contacts/${stays.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
