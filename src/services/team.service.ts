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
import { TeamConflictError, TeamMemberNotFoundError } from "@/domain/team/errors";
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

function isRetryableInvite(error: unknown): boolean {
  return isUniqueViolation(error) || error instanceof RetryableInviteError;
}

// After commit only. Links solely a Supabase user created right now; an
// existing one is linked on first login by verified e-mail (resolve-session).
async function provisionAuth(db: Db, userId: string, email: string): Promise<void> {
  const ensured = await getAuthAdmin().ensureAuthUser(email);
  if (ensured.created && ensured.authUserId) {
    // A false from linkAuthUser (another auth user linked first) is fine: the
    // first login links by verified e-mail.
    await UsersRepository.linkAuthUser(db, userId, ensured.authUserId);
  }
}

// Internal: the membership vanished between the decision and the read-back
// (a concurrent remove); handled like a lost 23505 race.
class RetryableInviteError extends Error {}

async function inviteOnce(db: Db, session: Session, input: { fullName: string; email: string }) {
  return runInTenantContext(db, session.organizationId, async (tx) => {
    const user = await TeamRepository.upsertAndLockUserByEmailWithTx(tx, input.email, input.fullName);
    // Cross-org check: memberships come from the SECURITY DEFINER lookup, so
    // they include other organizations even under RLS.
    const memberships = await OrganizationMembersRepository.listAllForUserWithTx(tx, user.id);
    const here = memberships.find((m) => m.organizationId === session.organizationId);

    // Decision order follows spec 2.1: MANAGER here (idempotent) -> OWNER here
    // -> creator here -> anything in another organization.
    if (here?.role !== "MANAGER") {
      if (here?.role === "OWNER") throw new TeamConflictError("ALREADY_IN_TEAM");
      if (here?.role === "CREATOR" || (await CreatorsRepository.findByUserIdWithTx(tx, session.organizationId, user.id))) {
        throw new TeamConflictError("IS_CREATOR");
      }
      if (
        memberships.some((m) => m.organizationId !== session.organizationId) ||
        (await CreatorsRepository.existsForUserOutsideOrganizationWithTx(tx, user.id, session.organizationId))
      ) {
        throw new TeamConflictError("OTHER_ORGANIZATION");
      }
    }

    let membershipId: string | undefined;
    if (here) {
      // Same-organization row: a plain org-scoped read is enough for its id.
      const [existing] = await tx
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, session.organizationId), eq(organizationMembers.userId, user.id)));
      membershipId = existing?.id;
    } else {
      const [inserted] = await tx
        .insert(organizationMembers)
        .values({ organizationId: session.organizationId, userId: user.id, role: "MANAGER" })
        .onConflictDoNothing()
        .returning({ id: organizationMembers.id });
      if (inserted) {
        membershipId = inserted.id;
        await DomainEventsRepository.appendWithTx(tx, session.organizationId, {
          eventType: "member.invited",
          entityType: "organization_member",
          entityId: inserted.id,
          payload: { membershipId: inserted.id, userId: user.id, invitedBy: session.userId },
          actor: { userId: session.userId },
        });
      }
    }
    if (!membershipId) throw new RetryableInviteError();

    const row = await TeamRepository.findStaffByMembershipWithTx(tx, session.organizationId, membershipId, false);
    if (!row) throw new RetryableInviteError();
    const organizationName = await TeamRepository.organizationNameWithTx(tx, session.organizationId);
    return { row, userId: user.id, organizationName };
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
      if (!isRetryableInvite(error)) throw error;
      // The failed transaction was rolled back; start a fresh one that
      // re-reads the winner's rows and re-applies every rule.
      try {
        result = await inviteOnce(db, session, { fullName, email });
      } catch (retryError) {
        if (isRetryableInvite(retryError)) throw new TeamConflictError("ALREADY_IN_TEAM");
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

  async remind(db: Db, session: Session, membershipId: string, origin: string) {
    const { row, organizationName } = await runInTenantContext(db, session.organizationId, async (tx) => {
      const found = await TeamRepository.findStaffByMembershipWithTx(tx, session.organizationId, membershipId, false);
      if (!found) throw new TeamMemberNotFoundError();
      if (found.role !== "MANAGER") throw new TeamConflictError("NOT_A_MANAGER");
      return { row: found, organizationName: await TeamRepository.organizationNameWithTx(tx, session.organizationId) };
    });
    await provisionAuth(db, row.userId, row.email);
    return buildTeamAccessInstructions({ fullName: row.fullName, organizationName, email: row.email, origin });
  },

  async remove(db: Db, session: Session, membershipId: string): Promise<void> {
    await runInTenantContext(db, session.organizationId, async (tx) => {
      const row = await TeamRepository.findStaffByMembershipWithTx(tx, session.organizationId, membershipId, true);
      if (!row) throw new TeamMemberNotFoundError();
      // Spec 2.4 lock order: membership, then the member's users row (the one
      // invite locks), so a concurrent re-invite serializes with this remove.
      await UsersRepository.lockByIdWithTx(tx, row.userId);
      if (row.role === "OWNER") throw new TeamConflictError("CANNOT_REMOVE_OWNER");
      // Defense in depth: unreachable while only OWNERs can remove and OWNER
      // targets are rejected first.
      if (row.userId === session.userId) throw new TeamConflictError("CANNOT_REMOVE_SELF");
      await tx
        .delete(organizationMembers)
        .where(and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, session.organizationId)));
      await DomainEventsRepository.appendWithTx(tx, session.organizationId, {
        eventType: "member.removed",
        entityType: "organization_member",
        entityId: membershipId,
        payload: { membershipId, userId: row.userId, removedBy: session.userId },
        actor: { userId: session.userId },
      });
    });
  },
};
