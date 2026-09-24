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

  // Returns true when the row was actually linked (it was unlinked at the
  // time of the write). Returns false when another auth user won the race
  // and linked this row first — callers must treat that as a failed link,
  // not silently proceed as if it were theirs.
  async linkAuthUser(db: NodePgDatabase<typeof schema>, userId: string, authUserId: string): Promise<boolean> {
    const rows = await db
      .update(users)
      .set({ authUserId })
      .where(and(eq(users.id, userId), isNull(users.authUserId)))
      .returning({ id: users.id });
    return rows.length > 0;
  },
};
