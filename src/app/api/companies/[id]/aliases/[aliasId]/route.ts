import { NextResponse } from "next/server";
import { db } from "@/db";
import { CrmService } from "@/services/crm.service";
import { getSession } from "@/lib/auth/session";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";
import { isUuid } from "@/lib/uuid";
import { COMPANY_NOT_FOUND, crmErrorResponse, notFoundResponse } from "../../../../crm-errors";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; aliasId: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  const { id, aliasId } = await params;
  if (!isUuid(id)) return notFoundResponse(COMPANY_NOT_FOUND);
  if (!isUuid(aliasId)) return notFoundResponse("Apelido não encontrado.");
  if (!canManageOrganization(session.role)) return forbiddenResponse();
  try {
    await CrmService.removeCompanyAlias(db, session.organizationId, id, aliasId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const mapped = crmErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
