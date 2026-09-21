import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { users } from "@/db/schema/organizations";
import { CreatorsRepository, type Creator } from "@/repositories/creators.repository";

export interface OnboardCreatorInput {
  email: string;
  fullName: string;
  displayName: string;
  instagramHandle?: string | null;
}

export const CreatorService = {
  async onboardCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: OnboardCreatorInput,
  ): Promise<Creator> {
    const [user] = await db
      .insert(users)
      .values({ email: input.email, fullName: input.fullName })
      .returning();

    return CreatorsRepository.create(db, organizationId, {
      userId: user.id,
      displayName: input.displayName,
      instagramHandle: input.instagramHandle ?? null,
    });
  },
};
