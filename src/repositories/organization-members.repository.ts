import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizationMembers } from "@/db/schema/organizations";
import { runInTenantContext } from "./tenant-context";

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
};
