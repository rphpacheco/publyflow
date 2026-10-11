"use client";

import * as React from "react";
import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSessionRole } from "@/components/shell/session-role-context";
import { AccessInstructionsDialog } from "@/components/creators/access-instructions-dialog";
import { InviteManagerDialog } from "@/components/team/invite-manager-dialog";
import { TeamMemberActions } from "@/components/team/team-member-actions";
import { useTeam, type TeamMemberDto } from "@/hooks/use-team";

const ROLE_LABEL: Record<TeamMemberDto["role"], string> = { OWNER: "Proprietário", MANAGER: "Gestor" };
const STATUS_LABEL: Record<TeamMemberDto["status"], string> = { invited: "Convidado", active: "Ativo" };

type Instructions = { email: string; message: string };

function NameWithBadge({ member }: { member: TeamMemberDto }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{member.fullName}</span>
      {member.isSelf ? <Badge variant="primary">Você</Badge> : null}
    </span>
  );
}

function StatusBadge({ member }: { member: TeamMemberDto }) {
  return <Badge variant={member.status === "active" ? "success" : "warning"}>{STATUS_LABEL[member.status]}</Badge>;
}

export default function TeamPage() {
  const router = useRouter();
  const role = useSessionRole();
  const isCreator = role === "CREATOR";
  const isOwner = role === "OWNER";
  const { data: team, isLoading, isError, refetch } = useTeam();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [instructions, setInstructions] = React.useState<Instructions | null>(null);

  React.useEffect(() => {
    if (isCreator) router.replace("/pipeline");
  }, [isCreator, router]);
  if (isCreator) return null;

  const showActions = (member: TeamMemberDto) => isOwner && member.role === "MANAGER";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Equipe</h1>
        {isOwner ? (
          <Button type="button" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" aria-hidden="true" />
            Convidar gestor
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">Não foi possível carregar a equipe.</p>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Situação</TableHead>
                  {isOwner ? <TableHead className="w-12" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(team ?? []).map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="min-w-0 max-w-64">
                      <NameWithBadge member={member} />
                    </TableCell>
                    <TableCell className="max-w-72 [overflow-wrap:anywhere]">{member.email}</TableCell>
                    <TableCell>{ROLE_LABEL[member.role]}</TableCell>
                    <TableCell>
                      <StatusBadge member={member} />
                    </TableCell>
                    {isOwner ? (
                      <TableCell className="text-right">
                        {showActions(member) ? <TeamMemberActions member={member} onInstructions={setInstructions} /> : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="flex flex-col gap-2 md:hidden">
            {(team ?? []).map((member) => (
              <li key={member.id} className="flex min-w-0 items-start justify-between gap-2 rounded-md border border-border p-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <NameWithBadge member={member} />
                  <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{member.email}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    {ROLE_LABEL[member.role]}
                    <StatusBadge member={member} />
                  </span>
                </div>
                {showActions(member) ? <TeamMemberActions member={member} onInstructions={setInstructions} /> : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {isOwner ? <InviteManagerDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={setInstructions} /> : null}
      <AccessInstructionsDialog
        open={instructions !== null}
        onOpenChange={(open) => !open && setInstructions(null)}
        email={instructions?.email ?? ""}
        message={instructions?.message ?? ""}
      />
    </div>
  );
}
