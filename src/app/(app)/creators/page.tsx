"use client";

import * as React from "react";
import { Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCreatorContext } from "@/components/shell/creator-context";
import { useIsCreator } from "@/components/shell/session-role-context";
import { CreatorFormDialog } from "@/components/creators/creator-form-dialog";
import { useCreators, type CreatorDto } from "@/hooks/use-creators";

const dateLabel = (iso: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));

export default function CreatorsPage() {
  const router = useRouter();
  const isCreator = useIsCreator();
  const { selectedCreatorId, selectCreator } = useCreatorContext();
  const { data: creators, isLoading, isError, refetch } = useCreators();
  const [dialog, setDialog] = React.useState<{ open: boolean; creator: CreatorDto | null; key: number }>({
    open: false,
    creator: null,
    key: 0,
  });

  React.useEffect(() => {
    if (isCreator) router.replace("/pipeline");
  }, [isCreator, router]);

  if (isCreator) return null;

  const openDialog = (creator: CreatorDto | null) =>
    setDialog((prev) => ({ open: true, creator, key: prev.key + 1 }));

  function onSaved(creator: CreatorDto, mode: "create" | "edit") {
    setDialog((prev) => ({ ...prev, open: false }));
    toast.success(mode === "create" ? "Creator cadastrado." : "Creator atualizado.");
    router.refresh();
    if (mode === "create" && selectedCreatorId === null) selectCreator(creator.id);
  }

  const newButton = (
    <Button type="button" onClick={() => openDialog(null)}>
      Novo creator
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Creators</h1>
        {!isError && creators && creators.length > 0 ? newButton : null}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">Não foi possível carregar os creators.</p>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : !creators || creators.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum creator cadastrado" action={newButton} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome de exibição</TableHead>
              <TableHead>@Instagram</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Cadastrado em</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {creators.map((creator) => (
              <TableRow key={creator.id}>
                <TableCell>{creator.displayName}</TableCell>
                <TableCell>{creator.instagramHandle ?? "—"}</TableCell>
                <TableCell>{creator.email}</TableCell>
                <TableCell>{dateLabel(creator.createdAt)}</TableCell>
                <TableCell>
                  <Button type="button" variant="outline" size="sm" onClick={() => openDialog(creator)}>
                    Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <CreatorFormDialog
        key={dialog.key}
        open={dialog.open}
        creator={dialog.creator}
        onOpenChange={(open) => setDialog((prev) => ({ ...prev, open }))}
        onSaved={onSaved}
      />
    </div>
  );
}
