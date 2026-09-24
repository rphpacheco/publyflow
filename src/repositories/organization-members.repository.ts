import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizationMembers } from "@/db/schema/organizations";
import { runInTenantContext } from "./tenant-context";
import type { SessionRole } from "@/lib/auth/types";

async function selectMembership(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)));
  return Boolean(row);
}

export const OrganizationMembersRepository = {
  async existsForOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    return runInTenantContext(db, organizationId, (tx) => selectMembership(tx, organizationId, userId));
  },

  async existsForOrganizationWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    return selectMembership(tx, organizationId, userId);
  },

  // Runs outside runInTenantContext on purpose: the organization is what we
  // are trying to determine. Today the app connects as a superuser, so RLS
  // does not filter this; the RLS hardening subproject must give this lookup
  // an explicit path (policy or privileged connection).
  async findOldestMembershipForUser(
    db: NodePgDatabase<typeof schema>,
    userId: string,
  ): Promise<{ organizationId: string; role: SessionRole } | null> {
    const [row] = await db
      .select({
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
      .orderBy(asc(organizationMembers.createdAt))
      .limit(1);
    return row ?? null;
  },
};
