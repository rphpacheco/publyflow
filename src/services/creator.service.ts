import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { users } from "@/db/schema/organizations";
import { CreatorsRepository, type Creator, type CreatorWithEmail, type CreatorWithAccess } from "@/repositories/creators.repository";
import { UsersRepository } from "@/repositories/users.repository";
import { runInTenantContext } from "@/repositories/tenant-context";
import { CreatorEmailTakenError } from "@/domain/creators/errors";
import type { CreateCreatorInput, UpdateCreatorInput } from "@/lib/creators/creator-input";

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === "23505";
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
          // creator. Without this, two concurrent registrations for the
          // same existing user + organization (double-click, two staff
          // members) could both read "no creator yet" and each insert one,
          // since there's no DB unique constraint backing this check. Under
          // READ COMMITTED, the second transaction blocks here until the
          // first commits, then its own findByUserIdWithTx (a fresh
          // statement) sees the first transaction's committed creator row.
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

  async listWithEmail(db: NodePgDatabase<typeof schema>, organizationId: string): Promise<CreatorWithEmail[]> {
    return CreatorsRepository.listWithEmailByOrganization(db, organizationId);
  },

  async listWithAccess(db: NodePgDatabase<typeof schema>, organizationId: string): Promise<CreatorWithAccess[]> {
    return CreatorsRepository.listWithAccessByOrganization(db, organizationId);
  },
};
