import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { conversations, messages } from "./conversations-messages";
import {
  commercialInquiries,
  leads,
  opportunities,
  opportunityStageHistory,
} from "./commercial-flow";

describe("commercial flow schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("carries a message through inquiry, lead, opportunity, and stage history", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [conversation] = await db
      .insert(conversations)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        source: "INSTAGRAM",
        externalContactLabel: "Maria — Bella Cosméticos",
      })
      .returning();
    const [message] = await db
      .insert(messages)
      .values({
        organizationId: org.id,
        conversationId: conversation.id,
        body: "Gostaríamos do mídia kit para uma campanha.",
        receivedAt: new Date(),
      })
      .returning();

    const [inquiry] = await db
      .insert(commercialInquiries)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        messageId: message.id,
        status: "NEW",
        companyGuess: "Bella Cosméticos",
      })
      .returning();

    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();

    const [lead] = await db
      .insert(leads)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        inquiryId: inquiry.id,
        contactId: contact.id,
        qualified: true,
      })
      .returning();

    await db
      .update(commercialInquiries)
      .set({ status: "CONVERTED", convertedLeadId: lead.id })
      .where(eq(commercialInquiries.id, inquiry.id));

    const [opportunity] = await db
      .insert(opportunities)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        leadId: lead.id,
        companyId: null,
        brandId: null,
        stage: "NOVO_LEAD",
        status: "OPEN",
      })
      .returning();

    const [historyEntry] = await db
      .insert(opportunityStageHistory)
      .values({ opportunityId: opportunity.id, fromStage: null, toStage: "NOVO_LEAD" })
      .returning();

    expect(historyEntry.opportunityId).toBe(opportunity.id);
    expect(opportunity.leadId).toBe(lead.id);
  });
});
