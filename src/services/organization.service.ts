import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizations, users, organizationMembers } from "@/db/schema/organizations";

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;

export interface CreateOrganizationInput {
  organizationName: string;
  ownerEmail: string;
  ownerFullName: string;
}

export const OrganizationService = {
  // NOTE: this insert runs on the plain `db` connection (no tenant context — an org
  // can't be scoped to a GUC before it exists). That's fine today because tests (and
  // for now, the app) connect as the Postgres superuser, which bypasses RLS.
  //
  // Task 5 found that the `organizations` RLS policy as written makes INSERT
  // structurally impossible for any non-superuser role subject to RLS: its implicit
  // WITH CHECK requires the new row's `id` to already equal `app.current_org_id`,
  // which can't be set before the row exists. Once this app connects to Postgres via
  // a restricted role (e.g. Supabase with RLS-enforcing credentials), this method's
  // insert will need either (a) the org UUID generated client-side, with
  // `app.current_org_id` set to that value before the insert, or (b) an
  // elevated/service-role connection for this one bootstrap operation.
  async createWithOwner(
    db: NodePgDatabase<typeof schema>,
    input: CreateOrganizationInput,
  ): Promise<{ organization: Organization; owner: User }> {
    return db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({ name: input.organizationName })
        .returning();

      const [owner] = await tx
        .insert(users)
        .values({ email: input.ownerEmail, fullName: input.ownerFullName })
        .returning();

      await tx.insert(organizationMembers).values({
        organizationId: organization.id,
        userId: owner.id,
        role: "OWNER",
      });

      return { organization, owner };
    });
  },
};
