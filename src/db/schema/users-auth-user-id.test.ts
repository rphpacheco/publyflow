import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { users } from "./organizations";

describe("users.auth_user_id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("is nullable by default and can be set", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [user] = await db
      .insert(users)
      .values({ email: "ana@publyflow.test", fullName: "Ana" })
      .returning();
    expect(user.authUserId).toBeNull();

    const authUserId = "11111111-1111-4111-8111-111111111111";
    await db.update(users).set({ authUserId }).where(eq(users.id, user.id));
    const [reloaded] = await db.select().from(users).where(eq(users.id, user.id));
    expect(reloaded.authUserId).toBe(authUserId);
  });

  it("rejects two users linked to the same auth user", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const authUserId = "22222222-2222-4222-8222-222222222222";
    await db.insert(users).values({ email: "a@publyflow.test", fullName: "A", authUserId });
    await expect(
      db.insert(users).values({ email: "b@publyflow.test", fullName: "B", authUserId }),
    ).rejects.toThrow();
  });
});
