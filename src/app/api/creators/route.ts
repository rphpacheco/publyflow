import { NextResponse } from "next/server";
import { db } from "@/db";
import { CreatorService } from "@/services/creator.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function GET(_request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const list = await CreatorService.listByOrganization(db, session.organizationId);
  return NextResponse.json(list, { status: 200 });
}
