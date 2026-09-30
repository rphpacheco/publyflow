import { NextResponse } from "next/server";
import { db } from "@/db";
import { CreatorAccessService } from "@/services/creator-access.service";
import { getSession } from "@/lib/auth/session";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";
import { CreatorAccessConflictError, CreatorNotFoundError } from "@/domain/creators/errors";
import { isUuid } from "@/lib/uuid";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const notFound = () => NextResponse.json({ error: new CreatorNotFoundError(id).message }, { status: 404 });
  if (!isUuid(id)) return notFound();
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const origin = new URL(request.url).origin;

  try {
    const instructions = await CreatorAccessService.invite(db, session.organizationId, id, origin);
    return NextResponse.json(instructions, { status: 200 });
  } catch (error) {
    if (error instanceof CreatorNotFoundError) return notFound();
    if (error instanceof CreatorAccessConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const notFound = () => NextResponse.json({ error: new CreatorNotFoundError(id).message }, { status: 404 });
  if (!isUuid(id)) return notFound();
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  try {
    await CreatorAccessService.revoke(db, session.organizationId, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof CreatorNotFoundError) return notFound();
    if (error instanceof CreatorAccessConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
    throw error;
  }
}
