import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { BrandService } from "@/services/brand.service";

const querySchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = querySchema.parse({ organizationId: url.searchParams.get("organizationId") });
  const list = await BrandService.listByOrganization(db, payload.organizationId);
  return NextResponse.json(list, { status: 200 });
}
