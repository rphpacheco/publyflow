import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CreatorService } from "@/services/creator.service";
import { getSession } from "@/lib/auth/session";
import { canManageCreators, forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { createCreatorSchema } from "@/lib/creators/creator-input";
import { CreatorEmailTakenError } from "@/domain/creators/errors";

export async function GET(_request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const list = await CreatorService.listWithEmail(db, session.organizationId);
  return NextResponse.json(list, { status: 200 });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  if (!canManageCreators(session.role)) return forbiddenResponse();

  const parsed = createCreatorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    const creator = await CreatorService.register(db, session.organizationId, parsed.data);
    return NextResponse.json(creator, { status: 201 });
  } catch (error) {
    if (error instanceof CreatorEmailTakenError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
