import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  CommercialInquiriesRepository,
  type CommercialInquiry,
} from "@/repositories/commercial-inquiries.repository";
import { ContactsRepository, type Contact } from "@/repositories/contacts.repository";
import { LeadsRepository, type Lead } from "@/repositories/leads.repository";
import { OpportunityService } from "./opportunity.service";
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

async function resolveContact(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: ResolveInquiryInput,
): Promise<{ contact: Contact; isNew: boolean }> {
  if ("id" in input.contact) {
    const contact = await ContactsRepository.findById(db, organizationId, input.contact.id);
    if (!contact) throw new Error(`Contact ${input.contact.id} not found`);
    return { contact, isNew: false };
  }

  const contact = await ContactsRepository.create(db, organizationId, {
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

  async resolve(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
    input: ResolveInquiryInput,
  ): Promise<ResolveInquiryResult> {
    const inquiry = await CommercialInquiriesRepository.findById(db, organizationId, inquiryId);
    if (!inquiry) throw new Error(`Commercial inquiry ${inquiryId} not found`);

    const { contact, isNew } = await resolveContact(db, organizationId, input);
    const companyId = input.companyId ?? null;
    const brandId = input.brandId ?? null;

    const existingOpportunity = await OpportunityService.findOpenOpportunityForParty(
      db,
      organizationId,
      { contactId: contact.id, companyId: companyId ?? undefined, brandId: brandId ?? undefined },
    );

    if (existingOpportunity) {
      const lead = await LeadsRepository.create(db, organizationId, {
        creatorId: inquiry.creatorId,
        inquiryId,
        contactId: contact.id,
        companyId,
        brandId,
        qualified: true,
      });

      const updatedInquiry = await CommercialInquiriesRepository.updateStatus(
        db,
        organizationId,
        inquiryId,
        { status: "CONVERTED", linkedOpportunityId: existingOpportunity.id },
      );

      return { inquiry: updatedInquiry, lead, opportunity: existingOpportunity };
    }

    const lead = await LeadsRepository.create(db, organizationId, {
      creatorId: inquiry.creatorId,
      inquiryId,
      contactId: contact.id,
      companyId,
      brandId,
      qualified: !isNew || Boolean(companyId || brandId),
    });

    const opportunity = await OpportunityService.createFromLead(db, organizationId, {
      leadId: lead.id,
      creatorId: inquiry.creatorId,
      companyId,
      brandId,
    });

    const updatedInquiry = await CommercialInquiriesRepository.updateStatus(
      db,
      organizationId,
      inquiryId,
      { status: "CONVERTED", convertedLeadId: lead.id },
    );

    return { inquiry: updatedInquiry, lead, opportunity };
  },
};
