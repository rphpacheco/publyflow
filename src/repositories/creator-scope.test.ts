import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedTwoCreators } from "@/test/helpers/two-creators";
import { OpportunitiesRepository } from "./opportunities.repository";
import { ProposalsRepository } from "./proposals.repository";
import { CommercialInquiriesRepository } from "./commercial-inquiries.repository";
import { InboxService } from "@/services/inbox.service";
import type { AIService } from "@/lib/ai/ai-service";
import type { MessageClassification } from "@/lib/ai/schemas";

function fakeAI(classification: MessageClassification): AIService {
  return { classifyMessage: async () => classification };
}

const commercialClassification: MessageClassification = {
  category: "COMMERCIAL_LEAD",
  commercialScore: 94,
  intent: "Pedido de mídia kit",
  extracted: {
    companyName: "Bella Cosméticos",
    brandName: null,
    contactName: "Maria",
    email: null,
    phone: null,
    budget: null,
    deliverables: null,
  },
};

describe("creator scope in repositories", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("opportunities: scoped findById hides other creators", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, x, y } = await seedTwoCreators(db);
    expect(await OpportunitiesRepository.findById(db, organization.id, y.opportunity.id)).not.toBeNull();
    expect(await OpportunitiesRepository.findById(db, organization.id, y.opportunity.id, x.creator.id)).toBeNull();
    expect((await OpportunitiesRepository.findById(db, organization.id, x.opportunity.id, x.creator.id))?.id).toBe(x.opportunity.id);
  });

  it("proposals: owner derives from the opportunity; scoped findById and isInCreatorScope", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, x, y } = await seedTwoCreators(db);
    expect(await ProposalsRepository.creatorIdForProposal(db, organization.id, y.proposal.id)).toBe(y.creator.id);
    expect(await ProposalsRepository.creatorIdForProposal(db, organization.id, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await ProposalsRepository.findById(db, organization.id, y.proposal.id, x.creator.id)).toBeNull();
    expect((await ProposalsRepository.findById(db, organization.id, x.proposal.id, x.creator.id))?.id).toBe(x.proposal.id);
    expect(await ProposalsRepository.isInCreatorScope(db, organization.id, y.proposal.id, x.creator.id)).toBe(false);
    expect(await ProposalsRepository.isInCreatorScope(db, organization.id, y.proposal.id, null)).toBe(true);
    expect(await ProposalsRepository.isInCreatorScope(db, organization.id, x.proposal.id, x.creator.id)).toBe(true);
  });

  it("proposals: cross-org opportunity is not trusted even if organizationId matches on the proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, x } = await seedTwoCreators(db);
    const otherOrgSeed = await seedTwoCreators(db);

    // Simulate a proposal in org A whose opportunity_id was repointed at an
    // opportunity belonging to org B (e.g. by a bug, or a bypassed check).
    await db.execute(
      sql`update proposals set opportunity_id = ${otherOrgSeed.x.opportunity.id} where id = ${x.proposal.id}`,
    );

    expect(await ProposalsRepository.creatorIdForProposal(db, organization.id, x.proposal.id)).toBeNull();
    expect(await ProposalsRepository.findById(db, organization.id, x.proposal.id, x.creator.id)).toBeNull();
  });

  it("commercial inquiries: scoped findById hides other creators; isInCreatorScope matches", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, x, y } = await seedTwoCreators(db);

    const ai = fakeAI(commercialClassification);
    const xResult = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: x.creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores para uma campanha.",
      receivedAt: new Date(),
    });
    const yResult = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: y.creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores para uma campanha.",
      receivedAt: new Date(),
    });
    const xInquiry = xResult.inquiry!;
    const yInquiry = yResult.inquiry!;
    expect(xInquiry).not.toBeNull();
    expect(yInquiry).not.toBeNull();

    expect(await CommercialInquiriesRepository.findById(db, organization.id, yInquiry.id)).not.toBeNull();
    expect(await CommercialInquiriesRepository.findById(db, organization.id, yInquiry.id, x.creator.id)).toBeNull();
    expect((await CommercialInquiriesRepository.findById(db, organization.id, xInquiry.id, x.creator.id))?.id).toBe(xInquiry.id);

    expect(await CommercialInquiriesRepository.isInCreatorScope(db, organization.id, yInquiry.id, x.creator.id)).toBe(false);
    expect(await CommercialInquiriesRepository.isInCreatorScope(db, organization.id, yInquiry.id, null)).toBe(true);
    expect(await CommercialInquiriesRepository.isInCreatorScope(db, organization.id, xInquiry.id, x.creator.id)).toBe(true);
  });
});
