import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ServiceService } from "@/services/service.service";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  unitDescription: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const payload = createSchema.parse(await request.json());
  const service = await ServiceService.create(db, payload.organizationId, {
    creatorId: payload.creatorId,
    name: payload.name,
    description: payload.description,
    unitDescription: payload.unitDescription,
  });
  return NextResponse.json(service, { status: 201 });
}

const listQuerySchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = listQuerySchema.parse({
    organizationId: url.searchParams.get("organizationId"),
    creatorId: url.searchParams.get("creatorId"),
  });
  const list = await ServiceService.listByCreator(db, payload.organizationId, payload.creatorId);
  return NextResponse.json(list, { status: 200 });
}
