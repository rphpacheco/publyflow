import { and, count, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { commercialInquiries } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalQueueService } from "./proposal-queue.service";

type Db = NodePgDatabase<typeof schema>;

export interface DashboardActions {
  untriagedInquiries: number;
  clientChangesRequested: number;
  creatorChangesRequested: number;
  awaitingCreatorApproval: number;
  readyToSend: number;
  awaitingClient: number;
  truncated: boolean;
}

export const DashboardActionsService = {
  // Reuses the /proposals queue classification so both screens always agree (spec D13).
  async get(db: Db, organizationId: string, options: { creatorScope: string | null }): Promise<DashboardActions> {
    const queue = await ProposalQueueService.list(db, organizationId, { creatorScope: options.creatorScope, includeArchived: false });
    const untriaged = await runInTenantContext(db, organizationId, async (tx) => {
      const conditions = [eq(commercialInquiries.organizationId, organizationId), eq(commercialInquiries.status, "NEW")];
      if (options.creatorScope !== null) conditions.push(eq(commercialInquiries.creatorId, options.creatorScope));
      const [row] = await tx.select({ n: count() }).from(commercialInquiries).where(and(...conditions));
      return Number(row.n);
    });
    const by = (situation: string) => queue.items.filter((item) => item.situation === situation);
    return {
      untriagedInquiries: untriaged,
      clientChangesRequested: by("changes_requested").filter((i) => i.changes?.by === "client").length,
      creatorChangesRequested: by("changes_requested").filter((i) => i.changes?.by === "creator").length,
      awaitingCreatorApproval: by("awaiting_creator").length,
      readyToSend: by("ready_to_send").length,
      awaitingClient: by("awaiting_client").length,
      truncated: queue.truncated,
    };
  },
};
