import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { leads } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "./tenant-context";

export type Lead = typeof leads.$inferSelect;

export const LeadsRepository = {
  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    leadId: string,
  ): Promise<Lead | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
      return lead ?? null;
    });
  },
};
