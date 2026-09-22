import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ServiceService } from "@/services/service.service";

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  unitDescription: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = updateSchema.parse(await request.json());
  const { organizationId, ...input } = payload;
  const service = await ServiceService.update(db, organizationId, id, input);
  return NextResponse.json(service, { status: 200 });
}
