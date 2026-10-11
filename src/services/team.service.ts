import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizationMembers } from "@/db/schema/organizations";
import { runInTenantContext } from "@/repositories/tenant-context";
import { TeamRepository, type StaffRow } from "@/repositories/team.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { UsersRepository } from "@/repositories/users.repository";
import { getAuthAdmin } from "@/lib/auth/auth-admin";
import { buildTeamAccessInstructions } from "@/lib/team/access-instructions";
import { TeamConflictError } from "@/domain/team/errors";
import type { Session } from "@/lib/auth/types";

type Db = NodePgDatabase<typeof schema>;

export interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  role: "OWNER" | "MANAGER";
  status: "invited" | "active";
  isSelf: boolean;
}

function toMember(row: StaffRow, session: Session): TeamMember {
  return {
    id: row.membershipId,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    status: row.firstLoginAt ? "active" : "invited",
    isSelf: row.userId === session.userId,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === "23505";
}

// After commit only. Links solely a Supabase user created right now; an
// existing one is linked on first login by verified e-mail (resolve-session).
async function provisionAuth(db: Db, userId: string, email: string): Promise<void> {
  const ensured = await getAuthAdmin().ensureAuthUser(email);
  if (ensured.created && ensured.authUserId) {
    await UsersRepository.linkAuthUser(db, userId, ensured.authUserId);
  }
}

async function inviteOnce(db: Db, session: Session, input: { fullName: string; email: string }) {
  return runInTenantContext(db, session.organizationId, async (tx) => {
    const user = await TeamRepository.upsertAndLockUserByEmailWithTx(tx, input.email, input.fullName);
    const memberships = await OrganizationMembersRepository.listForUser(tx, user.id);
    const here = memberships.find((m) => m.organizationId === session.organizationId);
    if (memberships.some((m) => m.organizationId !== session.organizationId)) throw new TeamConflictError("OTHER_ORGANIZATION");
    if (here?.role === "OWNER") throw new TeamConflictError("ALREADY_IN_TEAM");
    if (here?.role === "CREATOR" || (await CreatorsRepository.findByUserIdWithTx(tx, session.organizationId, user.id))) {
      throw new TeamConflictError("IS_CREATOR");
    }

    if (!here) {
      const [inserted] = await tx
        .insert(organizationMembers)
        .values({ organizationId: session.organizationId, userId: user.id, role: "MANAGER" })
        .onConflictDoNothing()
        .returning({ id: organizationMembers.id });
      if (inserted) {
        await DomainEventsRepository.appendWithTx(tx, session.organizationId, {
          eventType: "member.invited",
          entityType: "organization_member",
          entityId: inserted.id,
          payload: { membershipId: inserted.id, userId: user.id, invitedBy: session.userId },
          actor: { userId: session.userId },
        });
      }
    }

    const [membership] = await tx
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, session.organizationId), eq(organizationMembers.userId, user.id)));
    const row = await TeamRepository.findStaffByMembershipWithTx(tx, session.organizationId, membership.id, false);
    const organizationName = await TeamRepository.organizationNameWithTx(tx, session.organizationId);
    return { row: row!, userId: user.id, organizationName };
  });
}

export const TeamService = {
  async list(db: Db, session: Session): Promise<TeamMember[]> {
    return runInTenantContext(db, session.organizationId, async (tx) =>
      (await TeamRepository.listStaffWithTx(tx, session.organizationId)).map((row) => toMember(row, session)),
    );
  },

  async inviteManager(db: Db, session: Session, input: { fullName: string; email: string }, origin: string) {
    const email = input.email.trim();
    const fullName = input.fullName.trim();
    let result: Awaited<ReturnType<typeof inviteOnce>>;
    try {
      result = await inviteOnce(db, session, { fullName, email });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The failed transaction was rolled back; start a fresh one that
      // re-reads the winner's rows and re-applies every rule.
      try {
        result = await inviteOnce(db, session, { fullName, email });
      } catch (retryError) {
        if (isUniqueViolation(retryError)) throw new TeamConflictError("ALREADY_IN_TEAM");
        throw retryError;
      }
    }
    await provisionAuth(db, result.userId, result.row.email);
    const instructions = buildTeamAccessInstructions({
      fullName: result.row.fullName,
      organizationName: result.organizationName,
      email: result.row.email,
      origin,
    });
    return { member: toMember(result.row, session), ...instructions };
  },
};
