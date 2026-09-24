import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { users } from "@/db/schema/organizations";
import { UsersRepository } from "./users.repository";

const AUTH_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_AUTH_ID = "88888888-8888-4888-8888-888888888888";

describe("UsersRepository.linkAuthUser", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns true and links an unlinked row", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const [user] = await db.insert(users).values({ email: "a@publyflow.test", fullName: "A" }).returning();

    const linked = await UsersRepository.linkAuthUser(db, user.id, AUTH_ID);

    expect(linked).toBe(true);
    const [reloaded] = await db.select().from(users).where(eq(users.id, user.id));
    expect(reloaded.authUserId).toBe(AUTH_ID);
  });

  it("returns false and leaves the row untouched when it is already linked", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const [user] = await db
      .insert(users)
      .values({ email: "a@publyflow.test", fullName: "A", authUserId: OTHER_AUTH_ID })
      .returning();

    const linked = await UsersRepository.linkAuthUser(db, user.id, AUTH_ID);

    expect(linked).toBe(false);
    const [reloaded] = await db.select().from(users).where(eq(users.id, user.id));
    expect(reloaded.authUserId).toBe(OTHER_AUTH_ID);
  });
});
