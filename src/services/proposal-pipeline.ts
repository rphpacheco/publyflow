import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { OpportunitiesRepository, type Opportunity } from "@/repositories/opportunities.repository";
import { CLOSED_STAGES } from "@/lib/proposal-sharing";

/** Moves the opportunity (with stage history) unless it is already closed. */
export async function moveOpportunityIfOpenWithTx(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  opportunityId: string,
  stage: Opportunity["stage"],
): Promise<void> {
  const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, opportunityId);
  if (!opportunity || CLOSED_STAGES.has(opportunity.stage)) return;
  await OpportunitiesRepository.updateStageWithTx(tx, organizationId, opportunityId, stage);
}
