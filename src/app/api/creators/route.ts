import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CreatorService } from "@/services/creator.service";
import { getSession } from "@/lib/auth/session";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { canManageOrganization, isCreator } from "@/lib/auth/access";
import { createCreatorSchema } from "@/lib/creators/creator-input";
import { CreatorEmailTakenError } from "@/domain/creators/errors";

export async function GET(_request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  if (isCreator(session)) {
    const list = await CreatorService.listByOrganization(db, session.organizationId);
    const own = list
      .filter((creator) => creator.id === session.creatorId)
      .map((creator) => ({ id: creator.id, displayName: creator.displayName, instagramHandle: creator.instagramHandle }));
    return NextResponse.json(own, { status: 200 });
  }

  const list = await CreatorService.listWithAccess(db, session.organizationId);
  return NextResponse.json(list, { status: 200 });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  if (!canManageOrganization(session.role)) return forbiddenResponse();

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
