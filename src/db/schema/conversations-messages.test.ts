import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "./organizations";
import { creators } from "./creators";
import { users } from "./organizations";
import { conversations, messages } from "./conversations-messages";

describe("conversations/messages schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("stores a manually-entered message tied to a conversation and source", async () => {
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
        body: "Olá, gostaríamos de saber os valores para uma campanha.",
        receivedAt: new Date(),
      })
      .returning();

    expect(message.conversationId).toBe(conversation.id);
    expect(message.enteredManually).toBe(true);
  });
});
