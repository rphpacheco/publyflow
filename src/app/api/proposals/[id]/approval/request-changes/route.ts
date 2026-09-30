import { db } from "@/db";
import { ProposalApprovalService } from "@/services/proposal-approval.service";
import { handleCreatorDecision, requestChangesSchema } from "../decision";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleCreatorDecision(request, params, requestChangesSchema, (organizationId, proposalId, userId, message) =>
    ProposalApprovalService.requestChanges(db, organizationId, proposalId, userId, message ?? ""),
  );
}
