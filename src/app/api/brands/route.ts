import { NextResponse } from "next/server";
import { db } from "@/db";
import { BrandService } from "@/services/brand.service";
import { forbiddenResponse, getRouteSession } from "@/lib/auth/http";
import { canManageOrganization } from "@/lib/auth/access";

export async function GET(_request: Request) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;

  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const list = await BrandService.listByOrganization(db, session.organizationId);
  return NextResponse.json(list, { status: 200 });
}
