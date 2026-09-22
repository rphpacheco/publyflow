import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CompanyService } from "@/services/company.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });

  const company = await CompanyService.findById(db, payload.organizationId, id);
  if (!company) {
    return NextResponse.json({ error: `Company ${id} not found` }, { status: 404 });
  }
  return NextResponse.json(company, { status: 200 });
}
