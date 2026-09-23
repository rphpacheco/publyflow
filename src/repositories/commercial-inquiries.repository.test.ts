import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { InboxService } from "@/services/inbox.service";
import { CommercialInquiriesRepository } from "./commercial-inquiries.repository";
import type { AIService } from "@/lib/ai/ai-service";
import type { MessageClassification } from "@/lib/ai/schemas";

function fakeAI(classification: MessageClassification): AIService {
  return { classifyMessage: async () => classification };
}

function commercialClassification(intent: string): MessageClassification {
  return {
    category: "COMMERCIAL_LEAD",
    commercialScore: 90,
    intent,
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
}

async function setupOrgAndCreator(db: NodePgDatabase<typeof schema>) {
  const { organization } = await OrganizationService.createWithOwner(db, {
    organizationName: "Org",
    ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const creator = await CreatorService.onboardCreator(db, organization.id, {
    email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
    fullName: "Thais",
    displayName: "Thais",
  });
  return { organization, creator };
}

describe("CommercialInquiriesRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("lists inquiries by creator, ordered by createdAt desc, with an optional status filter", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, creator } = await setupOrgAndCreator(db);

    const { inquiry: inquiry1 } = await InboxService.ingestManualMessage(
      db,
      fakeAI(commercialClassification("Pedido de mídia kit")),
      organization.id,
      {
        creatorId: creator.id,
        source: "INSTAGRAM",
        externalContactLabel: "Maria — Bella Cosméticos",
        body: "Olá, gostaríamos de saber os valores.",
        receivedAt: new Date(),
      },
    );
    expect(inquiry1).not.toBeNull();

    const { inquiry: inquiry2 } = await InboxService.ingestManualMessage(
      db,
      fakeAI(commercialClassification("Pedido de parceria")),
      organization.id,
      {
        creatorId: creator.id,
        source: "WHATSAPP",
        externalContactLabel: "João — Outra Marca",
        body: "Oi, gostaríamos de fechar uma parceria.",
        receivedAt: new Date(),
      },
    );
    expect(inquiry2).not.toBeNull();

    await CommercialInquiriesRepository.updateStatus(db, organization.id, inquiry2!.id, {
      status: "DISCARDED",
    });

    const list = await CommercialInquiriesRepository.listByCreator(db, organization.id, creator.id);
    expect(list.length).toBe(2);
    expect(list.map((row) => row.id)).toEqual([inquiry2!.id, inquiry1!.id]);

    // Message enrichment: the row for inquiry1 must carry inquiry1's own
    // message content (body + who sent it + channel + timestamps), not
    // inquiry2's or some merged/wrong value.
    const inquiry1Row = list.find((row) => row.id === inquiry1!.id)!;
    expect(inquiry1Row.messageBody).toBe("Olá, gostaríamos de saber os valores.");
    expect(inquiry1Row.externalContactLabel).toBe("Maria — Bella Cosméticos");
    expect(inquiry1Row.source).toBe("INSTAGRAM");
    expect(inquiry1Row.messageReceivedAt).toBeInstanceOf(Date);
    expect(typeof inquiry1Row.conversationId).toBe("string");

    const inquiry2Row = list.find((row) => row.id === inquiry2!.id)!;
    expect(inquiry2Row.messageBody).toBe("Oi, gostaríamos de fechar uma parceria.");
    expect(inquiry2Row.externalContactLabel).toBe("João — Outra Marca");
    expect(inquiry2Row.source).toBe("WHATSAPP");
    expect(inquiry2Row.conversationId).not.toBe(inquiry1Row.conversationId);

    const newOnly = await CommercialInquiriesRepository.listByCreator(
      db,
      organization.id,
      creator.id,
      "NEW",
    );
    expect(newOnly).toHaveLength(1);
    expect(newOnly[0]!.id).toBe(inquiry1!.id);
    expect(newOnly.every((row) => row.status === "NEW")).toBe(true);

    const discardedOnly = await CommercialInquiriesRepository.listByCreator(
      db,
      organization.id,
      creator.id,
      "DISCARDED",
    );
    expect(discardedOnly).toHaveLength(1);
    expect(discardedOnly[0]!.id).toBe(inquiry2!.id);
  });
});
