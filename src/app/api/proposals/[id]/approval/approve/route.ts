import { db } from "@/db";
import { ProposalApprovalService } from "@/services/proposal-approval.service";
import { approveSchema, handleCreatorDecision } from "../decision";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleCreatorDecision(request, params, approveSchema, (organizationId, proposalId, userId, message) =>
    ProposalApprovalService.approve(db, organizationId, proposalId, userId, message),
  );
}
