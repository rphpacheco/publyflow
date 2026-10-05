import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { getSession } from "@/lib/auth/session";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";
import { isUuid } from "@/lib/uuid";
import { contactMergeSchema } from "@/lib/crm/merge-input";
import { CrmMergeService } from "@/services/crm-merge.service";
import { CONTACT_NOT_FOUND, crmErrorResponse, notFoundResponse } from "../../../crm-errors";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const { id } = await params;
  if (!isUuid(id)) return notFoundResponse(CONTACT_NOT_FOUND);
  if (!canManageOrganization(session.role)) return forbiddenResponse();
  const parsed = contactMergeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  try {
    return NextResponse.json(await CrmMergeService.mergeContact(db, session.organizationId, id, parsed.data.into, { userId: session.userId }));
  } catch (error) {
    const mapped = crmErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
