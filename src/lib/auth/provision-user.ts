import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizations, organizationMembers, users } from "@/db/schema/organizations";
import { UsersRepository } from "@/repositories/users.repository";

export interface AuthAdmin {
  createUser(input: { email: string; password: string }): Promise<{ id: string }>;
}

export interface ProvisionUserInput {
  email: string;
  fullName: string;
  role: "OWNER" | "MANAGER" | "CREATOR";
  organization: { id: string } | { newName: string };
  password?: string;
}

export interface ProvisionUserResult {
  organizationId: string;
  userId: string;
  authUserId: string | null;
  createdUser: boolean;
  createdMembership: boolean;
}

export async function provisionUser(
  db: NodePgDatabase<typeof schema>,
  admin: AuthAdmin,
  input: ProvisionUserInput,
): Promise<ProvisionUserResult> {
  // Database rows first, auth user last: a failure after this transaction
  // leaves rows that a rerun reuses, instead of an orphaned Supabase user.
  const { organizationId, userId, existingAuthUserId, createdUser, createdMembership } =
    await db.transaction(async (transaction) => {
      // `UsersRepository`'s methods are typed against `NodePgDatabase<typeof schema>`
      // (see src/repositories/tenant-context.ts for the same pattern), not the
      // narrower Drizzle transaction type `db.transaction()` yields, so the callback
      // param is cast the same way `runInTenantContext` does.
      const tx = transaction as unknown as NodePgDatabase<typeof schema>;

      let orgId: string;
      if ("id" in input.organization) {
        orgId = input.organization.id;
      } else {
        const [org] = await tx.insert(organizations).values({ name: input.organization.newName }).returning();
        orgId = org.id;
      }

      let user = await UsersRepository.findByEmail(tx, input.email);
      let userCreated = false;
      if (!user) {
        [user] = await tx.insert(users).values({ email: input.email, fullName: input.fullName }).returning();
        userCreated = true;
      }

      const [existingMembership] = await tx
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, user.id)));
      if (!existingMembership) {
        await tx.insert(organizationMembers).values({ organizationId: orgId, userId: user.id, role: input.role });
      }

      return {
        organizationId: orgId,
        userId: user.id,
        existingAuthUserId: user.authUserId,
        createdUser: userCreated,
        createdMembership: !existingMembership,
      };
    });

  let authUserId = existingAuthUserId;
  if (input.password && !authUserId) {
    const authUser = await admin.createUser({ email: input.email, password: input.password });
    const linked = await UsersRepository.linkAuthUser(db, userId, authUser.id);
    if (!linked) {
      throw new Error(
        `Could not link auth user ${authUser.id} to user ${userId}: the row was linked concurrently to a different auth user.`,
      );
    }
    authUserId = authUser.id;
  }

  return { organizationId, userId, authUserId, createdUser, createdMembership };
}
