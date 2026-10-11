import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizationMembers, organizations, users } from "@/db/schema/organizations";

type Tx = NodePgDatabase<typeof schema>;

export interface StaffRow {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  role: "OWNER" | "MANAGER";
  firstLoginAt: Date | null;
}

const staffColumns = {
  membershipId: organizationMembers.id,
  userId: users.id,
  fullName: users.fullName,
  email: users.email,
  role: organizationMembers.role,
  firstLoginAt: organizationMembers.firstLoginAt,
};

export const TeamRepository = {
  // OWNER first, then MANAGER; by lower(full_name), lower(email), id.
  async listStaffWithTx(tx: Tx, organizationId: string): Promise<StaffRow[]> {
    const rows = await tx
      .select(staffColumns)
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, organizationId), inArray(organizationMembers.role, ["OWNER", "MANAGER"])))
      .orderBy(
        sql`case when ${organizationMembers.role} = 'OWNER' then 0 else 1 end`,
        sql`lower(${users.fullName})`,
        sql`lower(${users.email})`,
        asc(organizationMembers.id),
      );
    return rows as StaffRow[];
  },

  async findStaffByMembershipWithTx(tx: Tx, organizationId: string, membershipId: string, lock: boolean): Promise<StaffRow | null> {
    const query = tx
      .select(staffColumns)
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.id, membershipId),
          eq(organizationMembers.organizationId, organizationId),
          inArray(organizationMembers.role, ["OWNER", "MANAGER"]),
        ),
      );
    const [row] = lock ? await query.for("update", { of: organizationMembers }) : await query;
    return (row as StaffRow | undefined) ?? null;
  },

  // Create-or-reuse by lower(email), then lock the row: a single row lock,
  // so concurrent invites of the same e-mail serialize here.
  async upsertAndLockUserByEmailWithTx(tx: Tx, email: string, fullName: string) {
    await tx.execute(sql`insert into users (email, full_name) values (${email}, ${fullName}) on conflict (lower(email)) do nothing`);
    const [user] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .for("update");
    return user;
  },

  async organizationNameWithTx(tx: Tx, organizationId: string): Promise<string> {
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId));
    return org.name;
  },
};
