import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CreatorService } from "@/services/creator.service";
import { getSession } from "@/lib/auth/session";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";
import { updateCreatorSchema } from "@/lib/creators/creator-input";
import { CreatorAccessConflictError, CreatorEmailTakenError, CreatorNotFoundError } from "@/domain/creators/errors";
import { isUuid } from "@/lib/uuid";

// Postgres deadlock (two transactions locking the same pair of `users` rows
// in opposite orders) -- changeEmail locks rows in ascending id order to
// avoid this, but concurrent callers on old code paths, or a future bug,
// could still produce one, and it must surface as a retryable 409 rather
// than an uncaught 500.
function isDeadlockError(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === "40P01";
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const notFound = () => NextResponse.json({ error: new CreatorNotFoundError(id).message }, { status: 404 });
  if (!isUuid(id)) return notFound();
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const parsed = updateCreatorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    if (parsed.data.email) {
      await CreatorService.changeEmail(db, session.organizationId, id, parsed.data.email);
    }
  } catch (error) {
    if (error instanceof CreatorNotFoundError) return notFound();
    if (error instanceof CreatorAccessConflictError || error instanceof CreatorEmailTakenError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (isDeadlockError(error)) {
      return NextResponse.json({ error: "Não foi possível salvar agora. Tente novamente." }, { status: 409 });
    }
    throw error;
  }

  const creator = await CreatorService.update(db, session.organizationId, id, parsed.data);
  if (!creator) return notFound();
  return NextResponse.json(creator, { status: 200 });
}
