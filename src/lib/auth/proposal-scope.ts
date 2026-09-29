import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { creatorScope } from "@/lib/auth/access";
import type { Session } from "@/lib/auth/types";

/**
 * True when the session's CREATOR scope excludes this proposal (OWNER/MANAGER
 * are never out of scope). Callers use this to return their route's own
 * not-found response instead of leaking that the proposal exists.
 */
export async function proposalOutOfScope(
  db: NodePgDatabase<typeof schema>,
  session: Session,
  proposalId: string,
): Promise<boolean> {
  const scope = creatorScope(session);
  if (scope === null) return false;
  return !(await ProposalsRepository.isInCreatorScope(db, session.organizationId, proposalId, scope));
}
