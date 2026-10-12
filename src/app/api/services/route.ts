import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ServiceService } from "@/services/service.service";
import { forbiddenResponse, getRouteSession } from "@/lib/auth/http";
import { canManageOrganization, denyCreatorWrite } from "@/lib/auth/access";

const createSchema = z.object({
  creatorId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  unitDescription: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;

  const denied = denyCreatorWrite(session);
  if (denied) return denied;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }
  const payload = parsed.data;
  const service = await ServiceService.create(db, session.organizationId, {
    creatorId: payload.creatorId,
    name: payload.name,
    description: payload.description,
    unitDescription: payload.unitDescription,
  });
  return NextResponse.json(service, { status: 201 });
}

const listQuerySchema = z.object({
  creatorId: z.string().uuid(),
});

export async function GET(request: Request) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;

  if (!canManageOrganization(session.role)) return forbiddenResponse();

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    creatorId: url.searchParams.get("creatorId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }
  const payload = parsed.data;
  const list = await ServiceService.listByCreator(db, session.organizationId, payload.creatorId);
  return NextResponse.json(list, { status: 200 });
}
