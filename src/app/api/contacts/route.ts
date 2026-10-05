import { NextResponse } from "next/server";
import { db } from "@/db";
import { CrmService } from "@/services/crm.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";

export async function GET(_request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const list = await CrmService.listContacts(db, session.organizationId);
  return NextResponse.json(list, { status: 200 });
}
