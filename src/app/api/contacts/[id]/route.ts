import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CrmService } from "@/services/crm.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";
import { isUuid } from "@/lib/uuid";
import { updateContactSchema } from "@/lib/crm/crm-input";
import { CONTACT_NOT_FOUND, crmErrorResponse, notFoundResponse } from "../../crm-errors";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const { id } = await params;
  if (!isUuid(id)) return notFoundResponse(CONTACT_NOT_FOUND);
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  try {
    return NextResponse.json(await CrmService.getContactDetail(db, session.organizationId, id), { status: 200 });
  } catch (error) {
    const mapped = crmErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const { id } = await params;
  if (!isUuid(id)) return notFoundResponse(CONTACT_NOT_FOUND);
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const parsed = updateContactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    return NextResponse.json(await CrmService.updateContact(db, session.organizationId, id, parsed.data), { status: 200 });
  } catch (error) {
    const mapped = crmErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
