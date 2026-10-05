"use client";

import * as React from "react";
import Link from "next/link";
import { Contact } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsCreator } from "@/components/shell/session-role-context";
import { useContacts } from "@/hooks/use-crm";
import { matchesSearch } from "@/lib/crm/search";

export default function ContactsPage() {
  const router = useRouter();
  const isCreator = useIsCreator();
  const { data: contacts, isLoading, isError, refetch } = useContacts();
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (isCreator) router.replace("/pipeline");
  }, [isCreator, router]);
  if (isCreator) return null;

  const visible = (contacts ?? []).filter((contact) => matchesSearch(query, contact.fullName, contact.email, contact.instagramHandle));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Contatos</h1>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">Não foi possível carregar os contatos.</p>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : !contacts || contacts.length === 0 ? (
        <EmptyState
          icon={Contact}
          title="Nenhum contato ainda"
          description="Contatos são criados ao converter mensagens do Inbox."
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
            aria-label="Buscar contato"
            placeholder="Buscar por nome, e-mail ou Instagram"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-sm"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Instagram</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((contact) => (
                <TableRow key={contact.id} className="cursor-pointer" onClick={() => router.push(`/contacts/${contact.id}`)}>
                  <TableCell>
                    <Link
                      href={`/contacts/${contact.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        router.push(`/contacts/${contact.id}`);
                      }}
                    >
                      {contact.fullName}
                    </Link>
                  </TableCell>
                  <TableCell>{contact.companyName ?? "—"}</TableCell>
                  <TableCell>{contact.email ?? "—"}</TableCell>
                  <TableCell>{contact.phone ?? "—"}</TableCell>
                  <TableCell>{contact.instagramHandle ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {visible.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum contato encontrado.</p> : null}
        </>
      )}
    </div>
  );
}
