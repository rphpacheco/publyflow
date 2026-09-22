import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { users } from "@/db/schema/organizations";
import { CreatorsRepository, type Creator } from "@/repositories/creators.repository";
import { runInTenantContext } from "@/repositories/tenant-context";

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
};
