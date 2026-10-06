import { and, eq, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { CreatorsRepository, type Creator, type CreatorWithEmail, type CreatorWithAccess } from "@/repositories/creators.repository";
import { UsersRepository, type User } from "@/repositories/users.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ACCESS_ERRORS, CreatorAccessConflictError, CreatorEmailTakenError, CreatorNotFoundError } from "@/domain/creators/errors";
import type { CreateCreatorInput, UpdateCreatorInput } from "@/lib/creators/creator-input";

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === "23505";
}

// Mirrors CreatorsRepository.listWithAccessByOrganization's emailEditable
// rule (see §Global Constraints): true iff none of the user's memberships
// (in any org) has logged in, the user has no auth account linked, none of
// those memberships is OWNER/MANAGER, and the user isn't a creator in
// another organization. Must run inside the same tx as the rest of
// changeEmail so the check and the write it gates are consistent.
async function isEmailEditable(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  userId: string,
  authUserId: string | null,
): Promise<boolean> {
  if (authUserId !== null) return false;
  const memberships = await OrganizationMembersRepository.listForUser(tx, userId);
  if (memberships.some((membership) => membership.firstLoginAt !== null)) return false;
  if (memberships.some((membership) => membership.role === "OWNER" || membership.role === "MANAGER")) return false;
  const [creatorElsewhere] = await tx
    .select({ id: creators.id })
    .from(creators)
    .where(and(eq(creators.userId, userId), ne(creators.organizationId, organizationId)));
  return !creatorElsewhere;
}

export interface OnboardCreatorInput {
  email: string;
  fullName: string;
  displayName: string;
  instagramHandle?: string | null;
}

export const CreatorService = {
  // The `users` insert and the `creators` insert share one transaction (via
  // runInTenantContext, which also sets app.current_org_id for the RLS
  // policy on `creators`) so they commit or roll back together. Without
  // this, a failure in the creator insert after the user insert already
  // committed would leave an orphaned `users` row -- and since users.email
  // is UNIQUE, retrying onboarding for the same email would then fail with
  // a duplicate-email error instead of the original failure.
  async onboardCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: OnboardCreatorInput,
  ): Promise<Creator> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: input.email, fullName: input.fullName })
        .returning();

      return CreatorsRepository.createWithTx(tx, organizationId, {
        userId: user.id,
        displayName: input.displayName,
        instagramHandle: input.instagramHandle ?? null,
      });
    });
  },

  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Creator[]> {
    return CreatorsRepository.listByOrganization(db, organizationId);
  },

  /**
   * Creates the creator, reusing the global `users` row when the e-mail already exists
   * (e.g. the owner registering their own creator profile). Never grants access:
   * no organization_members row is created here.
   */
  async register(db: NodePgDatabase<typeof schema>, organizationId: string, input: CreateCreatorInput): Promise<Creator> {
    try {
      return await runInTenantContext(db, organizationId, async (tx) => {
        const existing = await UsersRepository.findByEmail(tx, input.email);
        let userId: string;
        if (existing) {
          // Lock the existing user's row before re-checking for a duplicate
          // creator. The row lock serializes two concurrent registrations
          // for the same existing user + organization (double-click, two
          // staff members): under READ COMMITTED, the second transaction
          // blocks here until the first commits, then its own
          // findByUserIdWithTx (a fresh statement) sees the first
          // transaction's committed creator row. The creators_org_user_unique
          // constraint is the backstop; the outer catch maps its violation
          // to CreatorEmailTakenError.
          await UsersRepository.lockByIdWithTx(tx, existing.id);
          if (await CreatorsRepository.findByUserIdWithTx(tx, organizationId, existing.id)) {
            throw new CreatorEmailTakenError();
          }
          userId = existing.id;
        } else {
          const [user] = await tx.insert(users).values({ email: input.email, fullName: input.fullName }).returning();
          userId = user.id;
        }
        return CreatorsRepository.createWithTx(tx, organizationId, {
          userId,
          displayName: input.displayName,
          instagramHandle: input.instagramHandle,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new CreatorEmailTakenError();
      throw error;
    }
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    input: UpdateCreatorInput,
  ): Promise<Creator | null> {
    return runInTenantContext(db, organizationId, (tx) => CreatorsRepository.updateWithTx(tx, organizationId, creatorId, input));
  },

  /**
   * Corrects a creator's e-mail before they've ever accessed the app.
   * When the new e-mail already belongs to another `users` row, the
   * creator row and the (still-pending) CREATOR membership are moved to
   * that row atomically instead of being deleted and recreated, so the
   * membership keeps its id (and any first/last-login timestamps).
   */
  async changeEmail(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    newEmail: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, async (tx) => {
      const creator = await CreatorsRepository.findByIdWithTx(tx, organizationId, creatorId);
      if (!creator) throw new CreatorNotFoundError(creatorId);

      // Plain lookup (no lock yet): we need to know, before taking any row
      // lock, whether a distinct target user is involved, so both users'
      // rows can be locked in a canonical (ascending id) order below.
      // Locking in call order instead (current, then target) would deadlock
      // against a concurrent changeEmail transferring the opposite pair of
      // users (current <-> target swapped).
      const targetLookup = await UsersRepository.findByEmail(tx, newEmail);
      const targetId = targetLookup && targetLookup.id !== creator.userId ? targetLookup.id : null;

      let current: User | null;
      let target: User | null = null;
      if (targetId) {
        const [firstId, secondId] = [creator.userId, targetId].sort();
        const first = await UsersRepository.lockByIdWithTx(tx, firstId);
        const second = await UsersRepository.lockByIdWithTx(tx, secondId);
        current = firstId === creator.userId ? first : second;
        target = firstId === creator.userId ? second : first;
      } else {
        current = await UsersRepository.lockByIdWithTx(tx, creator.userId);
      }
      if (!current) throw new CreatorNotFoundError(creatorId);

      if (!(await isEmailEditable(tx, organizationId, current.id, current.authUserId))) {
        throw new CreatorAccessConflictError(ACCESS_ERRORS.emailLocked);
      }

      if (current.email.toLowerCase() === newEmail.toLowerCase()) return;

      // Re-validate against the freshly locked row: the plain lookup above
      // could be stale by the time both locks are held (the target user's
      // e-mail may have moved on while we waited).
      if (!target || target.email.toLowerCase() !== newEmail.toLowerCase()) {
        try {
          await tx.update(users).set({ email: newEmail }).where(eq(users.id, current.id));
        } catch (error) {
          if (isUniqueViolation(error)) throw new CreatorEmailTakenError();
          throw error;
        }
        return;
      }

      const targetMemberships = await OrganizationMembersRepository.listForUser(tx, target.id);

      // Temporary: remove when multi-organization sessions exist.
      // TODO: until then, this 409 tells an OWNER/MANAGER whether the target
      // e-mail already belongs to a user with a membership elsewhere -- a
      // minor enumeration probe that goes away with the restriction above.
      if (targetMemberships.some((membership) => membership.organizationId !== organizationId)) {
        throw new CreatorAccessConflictError(ACCESS_ERRORS.otherOrganization);
      }
      if (await CreatorsRepository.findByUserIdWithTx(tx, organizationId, target.id)) {
        throw new CreatorEmailTakenError();
      }
      if (
        targetMemberships.some(
          (membership) => membership.organizationId === organizationId && (membership.role === "OWNER" || membership.role === "MANAGER"),
        )
      ) {
        throw new CreatorAccessConflictError(ACCESS_ERRORS.team);
      }

      try {
        await tx
          .update(creators)
          .set({ userId: target.id })
          .where(and(eq(creators.id, creatorId), eq(creators.organizationId, organizationId)));
      } catch (error) {
        if (isUniqueViolation(error)) throw new CreatorEmailTakenError();
        throw error;
      }

      const membership = await OrganizationMembersRepository.findCreatorMembershipWithTx(tx, organizationId, current.id);
      if (membership) {
        await OrganizationMembersRepository.moveMembershipWithTx(tx, membership.id, target.id);
      }
    });
  },

  async listWithEmail(db: NodePgDatabase<typeof schema>, organizationId: string): Promise<CreatorWithEmail[]> {
    return CreatorsRepository.listWithEmailByOrganization(db, organizationId);
  },

  async listWithAccess(db: NodePgDatabase<typeof schema>, organizationId: string): Promise<CreatorWithAccess[]> {
    return CreatorsRepository.listWithAccessByOrganization(db, organizationId);
  },
};
