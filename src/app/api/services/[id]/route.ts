import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ServiceService } from "@/services/service.service";
import { ServiceNotFoundError } from "@/domain/rate-cards/errors";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";
import { isUuid } from "@/lib/uuid";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  unitDescription: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: new ServiceNotFoundError(id).message }, { status: 404 });
  }
  const payload = updateSchema.parse(await request.json());
  try {
    const service = await ServiceService.update(db, session.organizationId, id, payload);
    return NextResponse.json(service, { status: 200 });
  } catch (error) {
    if (error instanceof ServiceNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
