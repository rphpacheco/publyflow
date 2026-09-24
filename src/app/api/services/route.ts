import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ServiceService } from "@/services/service.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

const createSchema = z.object({
  creatorId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  unitDescription: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const payload = createSchema.parse(await request.json());
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
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const url = new URL(request.url);
  const payload = listQuerySchema.parse({
    creatorId: url.searchParams.get("creatorId"),
  });
  const list = await ServiceService.listByCreator(db, session.organizationId, payload.creatorId);
  return NextResponse.json(list, { status: 200 });
}
