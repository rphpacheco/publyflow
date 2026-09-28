import { NextResponse } from "next/server";
import { db } from "@/db";
import { CompanyService } from "@/services/company.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: `Company ${id} not found` }, { status: 404 });
  }
  const company = await CompanyService.findById(db, session.organizationId, id);
  if (!company) {
    return NextResponse.json({ error: `Company ${id} not found` }, { status: 404 });
  }
  return NextResponse.json(company, { status: 200 });
}
