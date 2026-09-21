import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  CommercialInquiriesRepository,
  type CommercialInquiry,
} from "@/repositories/commercial-inquiries.repository";
import { ContactsRepository, type Contact } from "@/repositories/contacts.repository";
import { LeadsRepository, type Lead } from "@/repositories/leads.repository";
import { OpportunityService } from "./opportunity.service";
import { runInTenantContext } from "@/repositories/tenant-context";
import type { Opportunity } from "@/repositories/opportunities.repository";

export interface ResolveContactByName {
  fullName: string;
  email?: string | null;
  phone?: string | null;
}

export interface ResolveInquiryInput {
  contact: { id: string } | ResolveContactByName;
  companyId?: string | null;
  brandId?: string | null;
}

export interface ResolveInquiryResult {
  inquiry: CommercialInquiry;
  lead: Lead;
  opportunity: Opportunity;
}

async function resolveContactWithTx(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: ResolveInquiryInput,
): Promise<{ contact: Contact; isNew: boolean }> {
  if ("id" in input.contact) {
    const contact = await ContactsRepository.findByIdWithTx(tx, organizationId, input.contact.id);
    if (!contact) throw new Error(`Contact ${input.contact.id} not found`);
    return { contact, isNew: false };
  }

  const contact = await ContactsRepository.createWithTx(tx, organizationId, {
    fullName: input.contact.fullName,
    email: input.contact.email ?? null,
    phone: input.contact.phone ?? null,
    companyId: input.companyId ?? null,
  });
  return { contact, isNew: true };
}

export const CommercialInquiryService = {
  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<CommercialInquiry | null> {
    return CommercialInquiriesRepository.findById(db, organizationId, inquiryId);
  },

  async discard(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<void> {
    await CommercialInquiriesRepository.updateStatus(db, organizationId, inquiryId, {
      status: "DISCARDED",
    });
  },

  async markFalsePositive(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<void> {
    await CommercialInquiriesRepository.updateStatus(db, organizationId, inquiryId, {
      status: "FALSE_POSITIVE",
    });
  },

  // Everything below — contact resolution, the Lead insert, the
  // Opportunity insert (or the "associate to existing Opportunity" branch),
  // and the final inquiry status update — shares one transaction via
  // runInTenantContext. A failure partway through (e.g.
  // OpportunityService.createFromLeadWithTx throwing
  // InvalidOpportunityPartyError after the Lead insert already ran) rolls
  // back everything written so far instead of leaving an orphaned Lead with
  // the inquiry stuck at its pre-resolve status.
  async resolve(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
    input: ResolveInquiryInput,
  ): Promise<ResolveInquiryResult> {
    const inquiry = await CommercialInquiriesRepository.findById(db, organizationId, inquiryId);
    if (!inquiry) throw new Error(`Commercial inquiry ${inquiryId} not found`);

    return runInTenantContext(db, organizationId, async (tx) => {
      const { contact, isNew } = await resolveContactWithTx(tx, organizationId, input);
      const companyId = input.companyId ?? null;
      const brandId = input.brandId ?? null;

      const existingOpportunity = await OpportunityService.findOpenOpportunityForPartyWithTx(
        tx,
        organizationId,
        { contactId: contact.id, companyId: companyId ?? undefined, brandId: brandId ?? undefined },
      );

      if (existingOpportunity) {
        const lead = await LeadsRepository.createWithTx(tx, organizationId, {
          creatorId: inquiry.creatorId,
          inquiryId,
          contactId: contact.id,
          companyId,
          brandId,
          qualified: true,
        });

        const updatedInquiry = await CommercialInquiriesRepository.updateStatusWithTx(
          tx,
          organizationId,
          inquiryId,
          { status: "CONVERTED", linkedOpportunityId: existingOpportunity.id },
        );

        return { inquiry: updatedInquiry, lead, opportunity: existingOpportunity };
      }

      const lead = await LeadsRepository.createWithTx(tx, organizationId, {
        creatorId: inquiry.creatorId,
        inquiryId,
        contactId: contact.id,
        companyId,
        brandId,
        qualified: !isNew || Boolean(companyId || brandId),
      });

      const opportunity = await OpportunityService.createFromLeadWithTx(tx, organizationId, {
        leadId: lead.id,
        creatorId: inquiry.creatorId,
        companyId,
        brandId,
      });

      const updatedInquiry = await CommercialInquiriesRepository.updateStatusWithTx(
        tx,
        organizationId,
        inquiryId,
        { status: "CONVERTED", convertedLeadId: lead.id },
      );

      return { inquiry: updatedInquiry, lead, opportunity };
    });
  },
};
