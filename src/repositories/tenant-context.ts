import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import type * as schema from "@/db/schema";

export async function runInTenantContext<T>(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Tenant transactions run as publyflow_app (no BYPASSRLS), so the org_isolation_*
    // policies apply on top of the explicit organization_id predicates.
    // TENANT_RLS=off is the emergency kill switch (privileged, pre-2026-10-12 behavior).
    await tx.execute(sql`select set_config('app.current_org_id', ${organizationId}, true)`);
    if (process.env.TENANT_RLS !== "off") {
      await tx.execute(sql`set local role publyflow_app`);
    }
    return fn(tx as unknown as NodePgDatabase<typeof schema>);
  }, config);
}
