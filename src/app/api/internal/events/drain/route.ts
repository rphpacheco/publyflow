import { NextResponse } from "next/server";
import { db } from "@/db";
import { EventDrainService } from "@/services/event-drain.service";

// Vercel Cron calls GET with `Authorization: Bearer ${CRON_SECRET}`.
async function drain(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await EventDrainService.drain(db);
  return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
export { drain as GET, drain as POST };
