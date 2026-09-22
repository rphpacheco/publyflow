import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import {
  ProposalItemsRepository,
  type ProposalItem,
  type UpdateProposalItemInput,
} from "@/repositories/proposal-items.repository";
import { ProposalVersionService } from "./proposal-version.service";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { RateCardItemsRepository } from "@/repositories/rate-card-items.repository";
import { RateCardsRepository } from "@/repositories/rate-cards.repository";
import { ServicesRepository } from "@/repositories/services.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { RateCardService } from "@/services/rate-card.service";
import {
  ProposalNotFoundError,
  OpportunityNotFoundError,
  RateCardItemCreatorMismatchError,
  UserNotOrganizationMemberError,
} from "@/domain/proposals/errors";
import { RateCardItemNotFoundError } from "@/domain/rate-cards/errors";

async function assertMember(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  userId: string,
): Promise<void> {
  const isMember = await OrganizationMembersRepository.existsForOrganizationWithTx(tx, organizationId, userId);
  if (!isMember) {
    throw new UserNotOrganizationMemberError(userId, organizationId);
  }
}

export type AddProposalItemInput = {
  proposalId: string;
  quantity?: number;
  sortOrder?: number;
  userId: string;
} & (
  | { rateCardItemId: string; description?: undefined; unitPrice?: undefined }
  | { rateCardItemId?: undefined; description: string; unitPrice: number }
);

export interface UpdateProposalItemServiceInput extends UpdateProposalItemInput {
  userId: string;
}

export const ProposalItemService = {
  async addItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: AddProposalItemInput,
  ): Promise<ProposalItem> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, input.proposalId);
      if (!proposal) {
        throw new ProposalNotFoundError(input.proposalId);
      }

      let description: string;
      let unitPrice: number;
      let rateCardItemId: string | null = null;

      if (input.rateCardItemId !== undefined) {
        const rateCardItem = await RateCardItemsRepository.findByIdWithTx(tx, organizationId, input.rateCardItemId);
        if (!rateCardItem) {
          throw new RateCardItemNotFoundError(input.rateCardItemId, "");
        }

        const rateCard = await RateCardsRepository.findByIdWithTx(tx, organizationId, rateCardItem.rateCardId);
        if (!rateCard) {
          throw new RateCardItemNotFoundError(input.rateCardItemId, rateCardItem.rateCardId);
        }

        const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, proposal.opportunityId);
        if (!opportunity) {
          throw new OpportunityNotFoundError(proposal.opportunityId);
        }

        if (rateCard.creatorId !== opportunity.creatorId) {
          throw new RateCardItemCreatorMismatchError(input.rateCardItemId, proposal.opportunityId);
        }

        const service = await ServicesRepository.findByIdWithTx(tx, organizationId, rateCardItem.serviceId);
        description = service?.name ?? "";
        unitPrice = rateCardItem.price;
        rateCardItemId = rateCardItem.id;

        if (!rateCard.isLocked) {
          await RateCardService.lockWithTx(tx, organizationId, rateCard.id);
        }
      } else {
        description = input.description;
        unitPrice = input.unitPrice;
      }

      const item = await ProposalItemsRepository.createWithTx(tx, organizationId, {
        proposalId: input.proposalId,
        rateCardItemId,
        description,
        unitPrice,
        quantity: input.quantity,
        sortOrder: input.sortOrder,
      });

      await ProposalVersionService.createVersionWithTx(tx, organizationId, input.proposalId, input.userId);

      return item;
    });
  },

  async updateItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
    input: UpdateProposalItemServiceInput,
  ): Promise<ProposalItem> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const items = await ProposalItemsRepository.listByProposalWithTx(tx, organizationId, proposalId);
      const before = items.find((row) => row.id === itemId) ?? null;

      const after = await ProposalItemsRepository.updateWithTx(tx, organizationId, itemId, proposalId, {
        description: input.description,
        unitPrice: input.unitPrice,
        quantity: input.quantity,
        sortOrder: input.sortOrder,
      });

      const changed =
        !before ||
        before.description !== after.description ||
        before.unitPrice !== after.unitPrice ||
        before.quantity !== after.quantity ||
        before.sortOrder !== after.sortOrder;

      if (changed) {
        await ProposalVersionService.createVersionWithTx(tx, organizationId, proposalId, input.userId);
      }

      return after;
    });
  },

  async removeItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
    userId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, userId);
      await ProposalItemsRepository.removeWithTx(tx, organizationId, itemId, proposalId);
      await ProposalVersionService.createVersionWithTx(tx, organizationId, proposalId, userId);
    });
  },
};
