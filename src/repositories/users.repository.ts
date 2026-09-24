import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { users } from "@/db/schema/organizations";

export type User = typeof users.$inferSelect;

// `users` is global (no organization_id, no RLS), so these run outside
// runInTenantContext.
export const UsersRepository = {
  async findByAuthUserId(db: NodePgDatabase<typeof schema>, authUserId: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.authUserId, authUserId));
    return user ?? null;
  },

  async findByEmail(db: NodePgDatabase<typeof schema>, email: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`);
    return user ?? null;
  },

  async linkAuthUser(db: NodePgDatabase<typeof schema>, userId: string, authUserId: string): Promise<void> {
    await db
      .update(users)
      .set({ authUserId })
      .where(and(eq(users.id, userId), isNull(users.authUserId)));
  },
};
