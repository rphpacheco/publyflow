import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalShareService } from "./proposal-share.service";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads } from "@/db/schema/commercial-flow";

describe("ProposalShareService.getShareInfo", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns title, creator and the opportunity's contact", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, opportunity, proposal } = await seedProposal(db);
    const [lead] = await db.select().from(leads).where(eq(leads.id, opportunity.leadId));
    await db.update(contacts).set({ phone: "(11) 98765-4321", email: "maria@bella.test" }).where(eq(contacts.id, lead.contactId));

    expect(await ProposalShareService.getShareInfo(db, organization.id, proposal.id)).toEqual({
      proposalTitle: "Campanha Verão",
      creatorName: "Thais",
      contact: { name: "Maria Fernandes", phone: "(11) 98765-4321", email: "maria@bella.test" },
    });
  });

  it("returns null for another organization's proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    expect(await ProposalShareService.getShareInfo(db, b.organization.id, a.proposal.id)).toBeNull();
  });
});
