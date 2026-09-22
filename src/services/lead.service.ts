import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { LeadsRepository, type Lead } from "@/repositories/leads.repository";

export const LeadService = {
  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<Lead[]> {
    return LeadsRepository.listByCreator(db, organizationId, creatorId);
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    leadId: string,
  ): Promise<Lead | null> {
    return LeadsRepository.findById(db, organizationId, leadId);
  },
};
