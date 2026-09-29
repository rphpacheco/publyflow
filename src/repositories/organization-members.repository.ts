import { and, asc, eq, sql } from "drizzle-orm";
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
      .orderBy(asc(organizationMembers.createdAt), asc(organizationMembers.id))
      .limit(1);
    return row ?? null;
  },

  // Runs outside runInTenantContext on purpose, like findOldestMembershipForUser:
  // this is used by CreatorAccessService to check a user's memberships across all
  // organizations, before any single organization's tenant context applies. Today
  // the app connects as a superuser, so RLS does not filter this.
  async listForUser(
    db: NodePgDatabase<typeof schema>,
    userId: string,
  ): Promise<Array<{ id: string; organizationId: string; role: SessionRole; firstLoginAt: Date | null }>> {
    return db
      .select({
        id: organizationMembers.id,
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
        firstLoginAt: organizationMembers.firstLoginAt,
      })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId));
  },

  // Runs outside runInTenantContext on purpose: this is called only at login
  // time (password action and OAuth/magic-link callback), before any tenant
  // context has been established for the request. Today the app connects as
  // a superuser, so RLS does not filter this.
  /** Called only at login time (password action and OAuth/magic-link callback), never per request. */
  async recordLogin(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    userId: string,
    now: Date,
  ): Promise<void> {
    await db
      .update(organizationMembers)
      .set({ firstLoginAt: sql`coalesce(${organizationMembers.firstLoginAt}, ${now})`, lastLoginAt: now })
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)));
  },
};
