import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizationMembers, users } from "@/db/schema/organizations";
import { CreatorsRepository, type Creator } from "@/repositories/creators.repository";
import { UsersRepository } from "@/repositories/users.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ACCESS_ERRORS, CreatorAccessConflictError, CreatorNotFoundError } from "@/domain/creators/errors";
import { buildAccessInstructions } from "@/lib/creators/access-instructions";

// Loads the creator and locks its current `users` row -- the same lock
// CreatorService.register/changeEmail take -- before this transaction reads
// or writes organization_members. `users` is reused across organizations
// (register can attach the same row to a creator in more than one org), so
// without this lock: two orgs inviting the same user concurrently could
// both pass the "not yet a member elsewhere" check and each insert a
// CREATOR membership; or an invite/revoke/remind here could read
// creator.userId while a concurrent CreatorService.changeEmail transfer is
// moving the creator to a different user, and act on the stale one.
async function loadLockedCreator(
  tx: NodePgDatabase<typeof schema>,
  orgId: string,
  creatorId: string,
): Promise<{ creator: Creator; email: string }> {
  const creator = await CreatorsRepository.findByIdWithTx(tx, orgId, creatorId);
  if (!creator) throw new CreatorNotFoundError(creatorId);

  await UsersRepository.lockByIdWithTx(tx, creator.userId);

  // Re-read after the lock: a changeEmail transfer that committed while we
  // waited for the lock may have moved this creator to a different user --
  // the lock above then guards a row the creator no longer points at. Lock
  // the current one too before reading its e-mail or touching
  // organization_members.
  const reloaded = await CreatorsRepository.findByIdWithTx(tx, orgId, creatorId);
  if (!reloaded) throw new CreatorNotFoundError(creatorId);
  if (reloaded.userId !== creator.userId) {
    await UsersRepository.lockByIdWithTx(tx, reloaded.userId);
  }

  const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, reloaded.userId));
  return { creator: reloaded, email: user.email };
}

export const CreatorAccessService = {
  async invite(
    db: NodePgDatabase<typeof schema>,
    orgId: string,
    creatorId: string,
    origin: string,
  ): Promise<{ loginUrl: string; message: string }> {
    return runInTenantContext(db, orgId, async (tx) => {
      const { creator, email } = await loadLockedCreator(tx, orgId, creatorId);

      const memberships = await OrganizationMembersRepository.listForUser(tx, creator.userId);

      // Temporary: remove when multi-organization sessions exist.
      // TODO: until then, this 409 tells an OWNER/MANAGER whether the
      // creator's e-mail already belongs to a user with a membership
      // elsewhere -- a minor enumeration probe that goes away with the
      // restriction above.
      if (memberships.some((membership) => membership.organizationId !== orgId)) {
        throw new CreatorAccessConflictError(ACCESS_ERRORS.otherOrganization);
      }

      const inThisOrg = memberships.find((membership) => membership.organizationId === orgId);
      if (inThisOrg && inThisOrg.role !== "CREATOR") {
        throw new CreatorAccessConflictError(ACCESS_ERRORS.team);
      }

      if (!inThisOrg) {
        await tx
          .insert(organizationMembers)
          .values({ organizationId: orgId, userId: creator.userId, role: "CREATOR" })
          .onConflictDoNothing();
      }

      return buildAccessInstructions({ displayName: creator.displayName, email, origin });
    });
  },

  async revoke(db: NodePgDatabase<typeof schema>, orgId: string, creatorId: string): Promise<void> {
    await runInTenantContext(db, orgId, async (tx) => {
      const { creator } = await loadLockedCreator(tx, orgId, creatorId);

      const memberships = await OrganizationMembersRepository.listForUser(tx, creator.userId);
      const inThisOrg = memberships.find((membership) => membership.organizationId === orgId);
      if (inThisOrg && inThisOrg.role !== "CREATOR") {
        throw new CreatorAccessConflictError(ACCESS_ERRORS.team);
      }

      await tx
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, orgId),
            eq(organizationMembers.userId, creator.userId),
            eq(organizationMembers.role, "CREATOR"),
          ),
        );
    });
  },

  async remind(
    db: NodePgDatabase<typeof schema>,
    orgId: string,
    creatorId: string,
    origin: string,
  ): Promise<{ loginUrl: string; message: string }> {
    return runInTenantContext(db, orgId, async (tx) => {
      const { creator, email } = await loadLockedCreator(tx, orgId, creatorId);

      const memberships = await OrganizationMembersRepository.listForUser(tx, creator.userId);
      const inThisOrg = memberships.find((membership) => membership.organizationId === orgId);
      if (!inThisOrg || inThisOrg.role !== "CREATOR") {
        throw new CreatorAccessConflictError(ACCESS_ERRORS.notInvited);
      }

      return buildAccessInstructions({ displayName: creator.displayName, email, origin });
    });
  },
};
