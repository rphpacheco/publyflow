import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CreatorService } from "@/services/creator.service";
import { getSession } from "@/lib/auth/session";
import { canManageCreators, forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { updateCreatorSchema } from "@/lib/creators/creator-input";
import { CreatorNotFoundError } from "@/domain/creators/errors";
import { isUuid } from "@/lib/uuid";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const notFound = () => NextResponse.json({ error: new CreatorNotFoundError(id).message }, { status: 404 });
  if (!isUuid(id)) return notFound();
  if (!canManageCreators(session.role)) return forbiddenResponse();

  const parsed = updateCreatorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  const creator = await CreatorService.update(db, session.organizationId, id, parsed.data);
  if (!creator) return notFound();
  return NextResponse.json(creator, { status: 200 });
}
