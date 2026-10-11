import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { users } from "@/db/schema/organizations";

describe("users_email_lower_unique", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("rejects the same e-mail in a different case", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    await db.insert(users).values({ email: "Ana@PublyFlow.test", fullName: "Ana" });
    await expect(db.insert(users).values({ email: "ana@publyflow.test", fullName: "Ana 2" })).rejects.toMatchObject({
      cause: { code: "23505", constraint: "users_email_lower_unique" },
    });
  });
});
