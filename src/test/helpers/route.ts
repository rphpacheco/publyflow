import { vi } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import type { Session } from "@/lib/auth/types";

export async function importRouteWithSession<T>(
  importRoute: () => Promise<T>,
  options: {
    db: NodePgDatabase<typeof schema>;
    session: Session | null;
    extraMocks?: () => void;
  },
): Promise<T> {
  vi.resetModules();
  vi.doMock("@/db", () => ({ db: options.db }));
  vi.doMock("@/lib/auth/session", () => ({
    getSession: async () => options.session,
  }));
  options.extraMocks?.();
  return importRoute();
}

export function ownerSession(organizationId: string, userId: string): Session {
  return { organizationId, userId, role: "OWNER" };
}
