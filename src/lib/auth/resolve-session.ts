import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { UsersRepository } from "@/repositories/users.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { CreatorsRepository } from "@/repositories/creators.repository";
import type { AuthUserIdentity, Session } from "./types";

export async function resolveSessionForAuthUser(
  db: NodePgDatabase<typeof schema>,
  authUser: AuthUserIdentity,
): Promise<Session | null> {
  let user = await UsersRepository.findByAuthUserId(db, authUser.id);

  if (!user) {
    if (!authUser.email) return null;
    if (!authUser.emailVerified) return null;
    const byEmail = await UsersRepository.findByEmail(db, authUser.email);
    if (!byEmail || byEmail.authUserId !== null) return null;
    const linked = await UsersRepository.linkAuthUser(db, byEmail.id, authUser.id);
    if (!linked) return null;
    user = { ...byEmail, authUserId: authUser.id };
  }

  const membership = await OrganizationMembersRepository.findOldestMembershipForUser(db, user.id);
  if (!membership) return null;

  if (membership.role === "CREATOR") {
    const creator = await CreatorsRepository.findByUserId(db, membership.organizationId, user.id);
    if (!creator) return null;
    return { userId: user.id, organizationId: membership.organizationId, role: "CREATOR", creatorId: creator.id };
  }

  return { userId: user.id, organizationId: membership.organizationId, role: membership.role, creatorId: null };
}
