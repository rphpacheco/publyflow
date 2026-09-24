import { NextResponse } from "next/server";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";
import { getSession } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/http";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  await CommercialInquiryService.discard(db, session.organizationId, id);
  return new NextResponse(null, { status: 204 });
}
