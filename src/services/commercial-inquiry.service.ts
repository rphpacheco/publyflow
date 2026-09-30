import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  CommercialInquiriesRepository,
  type CommercialInquiry,
  type CommercialInquiryWithMessage,
} from "@/repositories/commercial-inquiries.repository";
import { ContactsRepository, type Contact } from "@/repositories/contacts.repository";
import { LeadsRepository, type Lead } from "@/repositories/leads.repository";
import { CompaniesRepository } from "@/repositories/companies.repository";
import { BrandsRepository } from "@/repositories/brands.repository";
import { OpportunityService } from "./opportunity.service";
import { runInTenantContext } from "@/repositories/tenant-context";
import type { Opportunity } from "@/repositories/opportunities.repository";
import {
  InquiryAlreadyResolvedError,
  InquiryNotFoundError,
  AmbiguousPartyGuessError,
  InquiryPartyRequiredError,
} from "@/domain/commercial-flow/errors";

const TERMINAL_STATUSES = new Set<CommercialInquiry["status"]>(["DISCARDED", "FALSE_POSITIVE", "CONVERTED"]);

export interface ResolveContactByName {
  fullName: string;
  email?: string | null;
  phone?: string | null;
}

export interface ResolveInquiryInput {
  contact: { id: string } | ResolveContactByName;
  // Three-way distinction, easy to get wrong -- read carefully:
  //   - `undefined` (field omitted): not provided by the caller, so
  //     resolve() should try to resolve it from the inquiry's AI-guessed
  //     `companyGuess`/`brandGuess` (find-or-create by name).
  //   - `null`: the caller explicitly says "no company/brand" -- do NOT
  //     fall back to the guess.
  //   - a string: the caller already knows the id -- use it as-is, no
  //     guess resolution.
  companyId?: string | null;
  brandId?: string | null;
}

export interface ResolveInquiryResult {
  inquiry: CommercialInquiry;
  lead: Lead;
  opportunity: Opportunity;
}

export interface UpdateInquiryGuessesInput {
  contactName?: string | null;
  companyName?: string | null;
  brandName?: string | null;
}

async function resolveContactWithTx(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: ResolveInquiryInput,
  companyId: string | null,
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
    companyId,
  });
  return { contact, isNew: true };
}

// Fix 8: turns the AI's free-text companyGuess/brandGuess into a real
// companies/brands row when the caller didn't already pass an explicit id
// (see the three-way undefined/null/string contract documented on
// ResolveInquiryInput). find-or-create by name within the org, so a second
// inquiry with the same guess reuses the row instead of creating a
// duplicate.
async function resolvePartyIdFromGuess(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  explicitId: string | null | undefined,
  guess: string | null,
  repo: {
    listByName: (
      db: NodePgDatabase<typeof schema>,
      organizationId: string,
      name: string,
    ) => Promise<{ id: string }[]>;
    create: (
      db: NodePgDatabase<typeof schema>,
      organizationId: string,
      input: { name: string },
    ) => Promise<{ id: string }>;
  },
): Promise<string | null> {
  if (explicitId !== undefined) return explicitId;
  if (!guess) return null;

  const matches = await repo.listByName(tx, organizationId, guess);
  if (matches.length > 1) {
    throw new AmbiguousPartyGuessError(guess);
  }
  if (matches.length === 1) {
    return matches[0]!.id;
  }

  const created = await repo.create(tx, organizationId, { name: guess });
  return created.id;
}

export const CommercialInquiryService = {
  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<CommercialInquiry | null> {
    return CommercialInquiriesRepository.findById(db, organizationId, inquiryId);
  },

  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    status?: CommercialInquiry["status"],
  ): Promise<CommercialInquiryWithMessage[]> {
    return CommercialInquiriesRepository.listByCreator(db, organizationId, creatorId, status);
  },

  async discard(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<void> {
    await guardTerminalStatus(db, organizationId, inquiryId);
    const updated = await CommercialInquiriesRepository.updateStatus(db, organizationId, inquiryId, {
      status: "DISCARDED",
    });
    if (!updated) throw new InquiryNotFoundError(inquiryId);
  },

  async markFalsePositive(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<void> {
    await guardTerminalStatus(db, organizationId, inquiryId);
    const updated = await CommercialInquiriesRepository.updateStatus(db, organizationId, inquiryId, {
      status: "FALSE_POSITIVE",
    });
    if (!updated) throw new InquiryNotFoundError(inquiryId);
  },

  // Everything below — company/brand guess resolution, contact resolution,
  // the existing-Opportunity lookup, and (depending on which branch is
  // taken) the Lead/Opportunity inserts and the final inquiry status
  // update — shares one transaction via runInTenantContext. A failure
  // partway through (e.g. OpportunityService.createFromLeadWithTx throwing
  // InvalidOpportunityPartyError after the Lead insert already ran) rolls
  // back everything written so far instead of leaving an orphaned Lead with
  // the inquiry stuck at its pre-resolve status.
  async resolve(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
    input: ResolveInquiryInput,
  ): Promise<ResolveInquiryResult> {
    return runInTenantContext(db, organizationId, async (tx) => {
      // Fix F2: read-then-act on the inquiry's status must happen inside
      // the same transaction that later flips it to CONVERTED, and must
      // lock the row (`SELECT ... FOR UPDATE`) -- otherwise two concurrent
      // /convert requests for the same NEW inquiry can both pass the
      // terminal-status check before either commits, producing two Leads
      // and two Opportunities for one inquiry.
      const inquiry = await CommercialInquiriesRepository.lockByIdWithTx(tx, organizationId, inquiryId);
      if (!inquiry) throw new InquiryNotFoundError(inquiryId);
      if (TERMINAL_STATUSES.has(inquiry.status)) {
        throw new InquiryAlreadyResolvedError(inquiryId, inquiry.status);
      }

      const companyId = await resolvePartyIdFromGuess(
        tx,
        organizationId,
        input.companyId,
        inquiry.companyGuess,
        CompaniesRepository,
      );
      const brandId = await resolvePartyIdFromGuess(
        tx,
        organizationId,
        input.brandId,
        inquiry.brandGuess,
        BrandsRepository,
      );

      // Spec 2026-09-30 §3.2: an Opportunity needs a company or a brand;
      // refuse before inserting anything (contact, lead, opportunity).
      if (!companyId && !brandId) throw new InquiryPartyRequiredError(inquiryId);

      // Only match on contact identity when the caller passed an existing
      // contact id -- a brand-new {fullName,...} contact can't already be
      // linked to an open Opportunity, so there's nothing to match on and
      // no reason to insert it speculatively before we know whether an
      // existing Opportunity (matched via company/brand) will make the
      // insert unnecessary.
      const explicitContactId = "id" in input.contact ? input.contact.id : undefined;

      const existingOpportunity = await OpportunityService.findOpenOpportunityForPartyWithTx(
        tx,
        organizationId,
        {
          creatorId: inquiry.creatorId,
          contactId: explicitContactId,
          companyId: companyId ?? undefined,
          brandId: brandId ?? undefined,
        },
      );

      if (existingOpportunity) {
        // Per design spec Decisão #12: reusing an existing open
        // Opportunity for the same party must NOT create a second Lead or
        // Opportunity -- only associate this inquiry to the existing one.
        // The original Lead's contactId is left untouched -- it still
        // represents the original point of contact for this negotiation.
        //
        // The caller-supplied contact still needs to be persisted, though:
        // a second inquiry that matched on company/brand may be from a
        // different person at that company, and their name/email/phone
        // must not be silently discarded just because no new Lead was
        // created. resolveContactWithTx finds-or-creates it as a
        // standalone `contacts` row (find-or-create semantics live in
        // ContactsRepository for the `{id}` case; a `{fullName,...}` input
        // always creates a fresh row, same as the new-opportunity branch).
        const lead = await LeadsRepository.findByIdWithTx(tx, organizationId, existingOpportunity.leadId);
        if (!lead) {
          throw new Error(
            `Opportunity ${existingOpportunity.id} references missing lead ${existingOpportunity.leadId}`,
          );
        }

        await resolveContactWithTx(tx, organizationId, input, companyId);

        const updatedInquiry = await CommercialInquiriesRepository.updateStatusWithTx(
          tx,
          organizationId,
          inquiryId,
          { status: "CONVERTED", linkedOpportunityId: existingOpportunity.id },
        );
        if (!updatedInquiry) throw new InquiryNotFoundError(inquiryId);

        return { inquiry: updatedInquiry, lead, opportunity: existingOpportunity };
      }

      const { contact, isNew } = await resolveContactWithTx(tx, organizationId, input, companyId);

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
      if (!updatedInquiry) throw new InquiryNotFoundError(inquiryId);

      return { inquiry: updatedInquiry, lead, opportunity };
    });
  },

  async updateGuesses(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
    input: UpdateInquiryGuessesInput,
  ): Promise<CommercialInquiry> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const inquiry = await CommercialInquiriesRepository.lockByIdWithTx(tx, organizationId, inquiryId);
      if (!inquiry) throw new InquiryNotFoundError(inquiryId);
      if (inquiry.status !== "NEW") throw new InquiryAlreadyResolvedError(inquiryId, inquiry.status);

      const normalize = (value: string | null) => {
        const trimmed = value?.trim() ?? "";
        return trimmed === "" ? null : trimmed;
      };
      const fields: Partial<Pick<CommercialInquiry, "contactNameGuess" | "companyGuess" | "brandGuess">> = {};
      if (input.contactName !== undefined) fields.contactNameGuess = normalize(input.contactName);
      if (input.companyName !== undefined) fields.companyGuess = normalize(input.companyName);
      if (input.brandName !== undefined) fields.brandGuess = normalize(input.brandName);
      if (Object.keys(fields).length === 0) return inquiry;

      const updated = await CommercialInquiriesRepository.updateGuessesWithTx(tx, organizationId, inquiryId, fields);
      if (!updated) throw new InquiryNotFoundError(inquiryId);
      return updated;
    });
  },
};

async function guardTerminalStatus(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  inquiryId: string,
): Promise<void> {
  const inquiry = await CommercialInquiriesRepository.findById(db, organizationId, inquiryId);
  if (!inquiry) throw new InquiryNotFoundError(inquiryId);
  if (TERMINAL_STATUSES.has(inquiry.status)) {
    throw new InquiryAlreadyResolvedError(inquiryId, inquiry.status);
  }
}
