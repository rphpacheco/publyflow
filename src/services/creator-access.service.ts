import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizationMembers, users } from "@/db/schema/organizations";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ACCESS_ERRORS, CreatorAccessConflictError, CreatorNotFoundError } from "@/domain/creators/errors";
import { buildAccessInstructions } from "@/lib/creators/access-instructions";

async function loadCreatorAndEmail(db: NodePgDatabase<typeof schema>, orgId: string, creatorId: string) {
  const creator = await runInTenantContext(db, orgId, (tx) => CreatorsRepository.findByIdWithTx(tx, orgId, creatorId));
  if (!creator) throw new CreatorNotFoundError(creatorId);

  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, creator.userId));

  return { creator, email: user.email };
}

export const CreatorAccessService = {
  async invite(
    db: NodePgDatabase<typeof schema>,
    orgId: string,
    creatorId: string,
    origin: string,
  ): Promise<{ loginUrl: string; message: string }> {
    const { creator, email } = await loadCreatorAndEmail(db, orgId, creatorId);

    const memberships = await OrganizationMembersRepository.listForUser(db, creator.userId);

    // Temporary: remove when multi-organization sessions exist.
    if (memberships.some((membership) => membership.organizationId !== orgId)) {
      throw new CreatorAccessConflictError(ACCESS_ERRORS.otherOrganization);
    }

    const inThisOrg = memberships.find((membership) => membership.organizationId === orgId);
    if (inThisOrg && inThisOrg.role !== "CREATOR") {
      throw new CreatorAccessConflictError(ACCESS_ERRORS.team);
    }

    if (!inThisOrg) {
      await db
        .insert(organizationMembers)
        .values({ organizationId: orgId, userId: creator.userId, role: "CREATOR" })
        .onConflictDoNothing();
    }

    return buildAccessInstructions({ displayName: creator.displayName, email, origin });
  },

  async revoke(db: NodePgDatabase<typeof schema>, orgId: string, creatorId: string): Promise<void> {
    const { creator } = await loadCreatorAndEmail(db, orgId, creatorId);

    const memberships = await OrganizationMembersRepository.listForUser(db, creator.userId);
    const inThisOrg = memberships.find((membership) => membership.organizationId === orgId);
    if (inThisOrg && inThisOrg.role !== "CREATOR") {
      throw new CreatorAccessConflictError(ACCESS_ERRORS.team);
    }

    await db
      .delete(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, creator.userId),
          eq(organizationMembers.role, "CREATOR"),
        ),
      );
  },

  async remind(
    db: NodePgDatabase<typeof schema>,
    orgId: string,
    creatorId: string,
    origin: string,
  ): Promise<{ loginUrl: string; message: string }> {
    const { creator, email } = await loadCreatorAndEmail(db, orgId, creatorId);

    const memberships = await OrganizationMembersRepository.listForUser(db, creator.userId);
    const inThisOrg = memberships.find((membership) => membership.organizationId === orgId);
    if (!inThisOrg || inThisOrg.role !== "CREATOR") {
      throw new CreatorAccessConflictError(ACCESS_ERRORS.notInvited);
    }

    return buildAccessInstructions({ displayName: creator.displayName, email, origin });
  },
};
