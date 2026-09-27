import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { notifications } from "@/db/schema/domain-events";
import { organizationMembers } from "@/db/schema/organizations";

export type Notification = typeof notifications.$inferSelect;

export interface FanOutInput {
  sourceEventId: string;
  kind: string;
  title: string;
  body: string | null;
  linkPath: string | null;
}

export const NotificationsRepository = {
  /** One row per organization member; replays insert nothing. */
  async fanOutWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, input: FanOutInput): Promise<number> {
    const members = await tx
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId));
    if (members.length === 0) return 0;
    const inserted = await tx
      .insert(notifications)
      .values(members.map((member) => ({ organizationId, recipientUserId: member.userId, ...input })))
      .onConflictDoNothing({ target: [notifications.sourceEventId, notifications.recipientUserId] })
      .returning({ id: notifications.id });
    return inserted.length;
  },

  async listForUser(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    userId: string,
    limit: number,
  ): Promise<{ items: Notification[]; unreadCount: number }> {
    const mine = and(eq(notifications.organizationId, organizationId), eq(notifications.recipientUserId, userId));
    const items = await db.select().from(notifications).where(mine).orderBy(desc(notifications.createdAt)).limit(limit);
    const [{ value }] = await db.select({ value: count() }).from(notifications).where(and(mine, isNull(notifications.readAt)));
    return { items, unreadCount: Number(value) };
  },

  async markRead(db: NodePgDatabase<typeof schema>, organizationId: string, userId: string, notificationId: string, now: Date): Promise<boolean> {
    const updated = await db
      .update(notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.organizationId, organizationId),
          eq(notifications.recipientUserId, userId),
        ),
      )
      .returning({ id: notifications.id });
    return updated.length > 0;
  },

  async markAllRead(db: NodePgDatabase<typeof schema>, organizationId: string, userId: string, now: Date): Promise<number> {
    const updated = await db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.organizationId, organizationId), eq(notifications.recipientUserId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return updated.length;
  },
};
