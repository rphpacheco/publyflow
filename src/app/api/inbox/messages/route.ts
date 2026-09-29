import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ai } from "@/lib/ai";
import { InboxService } from "@/services/inbox.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { MessageClassificationError } from "@/domain/inbox/errors";
import { isCreator } from "@/lib/auth/access";

const bodySchema = z.object({
  creatorId: z.string().uuid(),
  source: z.enum(["INSTAGRAM", "WHATSAPP", "TIKTOK"]),
  externalContactLabel: z.string().min(1),
  body: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const payload = bodySchema.parse(await request.json());

  try {
    const result = await InboxService.ingestManualMessage(db, ai, session.organizationId, {
      creatorId: isCreator(session) ? session.creatorId! : payload.creatorId,
      source: payload.source,
      externalContactLabel: payload.externalContactLabel,
      body: payload.body,
      receivedAt: new Date(),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof MessageClassificationError) {
      console.error("Inbox message classification failed", error.cause);
      return NextResponse.json(
        { error: "Não foi possível classificar a mensagem agora. Tente novamente em instantes." },
        { status: 502 },
      );
    }
    throw error;
  }
}
