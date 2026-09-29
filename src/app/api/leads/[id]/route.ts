import { NextResponse } from "next/server";
import { db } from "@/db";
import { LeadService } from "@/services/lead.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";
import { isUuid } from "@/lib/uuid";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: `Lead ${id} not found` }, { status: 404 });
  }

  const lead = await LeadService.findById(db, session.organizationId, id);
  if (!lead) {
    return NextResponse.json({ error: `Lead ${id} not found` }, { status: 404 });
  }
  return NextResponse.json(lead, { status: 200 });
}
