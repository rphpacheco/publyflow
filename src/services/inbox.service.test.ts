import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { InboxService } from "./inbox.service";
import type { AIService } from "@/lib/ai/ai-service";
import type { MessageClassification } from "@/lib/ai/schemas";
import { conversations, messages } from "@/db/schema/conversations-messages";
import { CommercialInquiriesRepository } from "@/repositories/commercial-inquiries.repository";

function fakeAI(classification: MessageClassification): AIService {
  return { classifyMessage: async () => classification };
}

describe("InboxService.ingestManualMessage", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a Commercial Inquiry when the message is classified as commercial", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const ai = fakeAI({
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
    });

    const result = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores para uma campanha.",
      receivedAt: new Date(),
    });

    expect(result.inquiry).not.toBeNull();
    expect(result.inquiry?.status).toBe("NEW");
    expect(result.inquiry?.companyGuess).toBe("Bella Cosméticos");
  });

  it("does not create a Commercial Inquiry for a FAN message", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner2@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais2@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const ai = fakeAI({
      category: "FAN",
      commercialScore: 2,
      intent: null,
      extracted: {
        companyName: null,
        brandName: null,
        contactName: null,
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    });

    const result = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Fã anônimo",
      body: "Amo seus vídeos! Você é maravilhosa",
      receivedAt: new Date(),
    });

    expect(result.inquiry).toBeNull();
  });

  it("rolls back the conversation and message if the inquiry insert fails", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner3@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais3@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const ai = fakeAI({
      category: "COMMERCIAL_LEAD",
      commercialScore: 91,
      intent: "Pedido de orçamento",
      extracted: {
        companyName: "Some Co",
        brandName: null,
        contactName: null,
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    });

    // Simulate a failure partway through the transaction: the conversation
    // and message inserts succeed, then the inquiry insert throws. This
    // proves all three writes share one transaction — if they didn't, the
    // conversation/message rows would remain committed despite the inquiry
    // insert failing.
    const insertSpy = vi
      .spyOn(CommercialInquiriesRepository, "createFromClassificationWithTx")
      .mockRejectedValue(new Error("simulated inquiry insert failure"));

    try {
      await expect(
        InboxService.ingestManualMessage(db, ai, organization.id, {
          creatorId: creator.id,
          source: "INSTAGRAM",
          externalContactLabel: "Someone",
          body: "Gostaria de um orçamento para divulgação.",
          receivedAt: new Date(),
        }),
      ).rejects.toThrow("simulated inquiry insert failure");
    } finally {
      insertSpy.mockRestore();
    }

    const remainingMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.organizationId, organization.id));
    expect(remainingMessages).toHaveLength(0);

    const remainingConversations = await db
      .select()
      .from(conversations)
      .where(eq(conversations.organizationId, organization.id));
    expect(remainingConversations).toHaveLength(0);
  });
});
