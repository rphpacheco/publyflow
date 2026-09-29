import { describe, it, expect, afterEach, vi } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { UsersRepository } from "@/repositories/users.repository";
import { CreatorEmailTakenError } from "@/domain/creators/errors";
import { users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";

describe("CreatorService.onboardCreator", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a user and a linked creator in the same organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });

    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais Miranda",
      displayName: "Thais Miranda",
      instagramHandle: "thaimiranda",
    });

    expect(creator.organizationId).toBe(organization.id);
    expect(creator.displayName).toBe("Thais Miranda");
  });

  it("leaves no orphaned users row when the creator insert fails (Fix 5)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}@publyflow.test`,
      ownerFullName: "Owner",
    });

    const email = `orphan-check-${Date.now()}@publyflow.test`;

    // Simulate a failure partway through onboardCreator: the `users`
    // insert succeeds, then the creator insert throws. This proves both
    // inserts share one transaction -- if they didn't, the `users` row
    // would remain committed despite onboardCreator rejecting, and since
    // users.email is UNIQUE, retrying with the same email would then fail
    // with a duplicate-email error instead of the original one.
    const createSpy = vi
      .spyOn(CreatorsRepository, "createWithTx")
      .mockRejectedValue(new Error("simulated creator insert failure"));

    try {
      await expect(
        CreatorService.onboardCreator(db, organization.id, {
          email,
          fullName: "Orphan Check",
          displayName: "Orphan Check",
        }),
      ).rejects.toThrow("simulated creator insert failure");
    } finally {
      createSpy.mockRestore();
    }

    const remainingUsers = await db.select().from(users).where(eq(users.email, email));
    expect(remainingUsers).toHaveLength(0);

    // Retrying with the same email must now succeed (no duplicate-email
    // error from an orphaned row).
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email,
      fullName: "Orphan Check",
      displayName: "Orphan Check",
    });
    expect(creator.displayName).toBe("Orphan Check");
  });
});

describe("CreatorService.register / update", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup?.();
  });

  async function org(db: Awaited<ReturnType<typeof withTestDb>>["db"], name = "Org") {
    return OrganizationService.createWithOwner(db, {
      organizationName: name,
      ownerEmail: `owner-${name}@publyflow.test`,
      ownerFullName: "Owner",
    });
  }
  const input = { fullName: "Thais Rocha", displayName: "Thais", email: "thais@publyflow.test", instagramHandle: "@thais" };

  it("creates a user and a creator", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await org(db);
    const creator = await CreatorService.register(db, organization.id, input);
    expect(creator).toMatchObject({ organizationId: organization.id, displayName: "Thais", instagramHandle: "@thais" });
    const [user] = await db.select().from(users).where(eq(users.id, creator.userId));
    expect(user).toMatchObject({ email: "thais@publyflow.test", fullName: "Thais Rocha" });
  });

  it("serializes two concurrent registrations for the same existing user (race)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await org(db);

    // Hold a row lock on the owner's `users` row in a separate, long-running
    // transaction to simulate a second concurrent request that gets there
    // first. `register` must block on this same lock before it re-checks
    // for an existing creator, or both requests could pass the check and
    // each insert a creator.
    let signalLockAcquired: () => void = () => {};
    const lockAcquired = new Promise<void>((resolve) => {
      signalLockAcquired = resolve;
    });
    let releaseHeldTx: () => void = () => {};
    const releaseSignal = new Promise<void>((resolve) => {
      releaseHeldTx = resolve;
    });

    const holdingTx = db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${users} where id = ${owner.id} for update`);
      signalLockAcquired();
      await releaseSignal;
      // Insert the creator that the pending register() call must see once
      // it acquires the lock, so its duplicate check finds it.
      await tx.insert(creators).values({ organizationId: organization.id, userId: owner.id, displayName: "Racer" });
    });

    await lockAcquired;

    const registerPromise = CreatorService.register(db, organization.id, { ...input, email: owner.email });

    // Give register() time to reach (and block on) the lock before we
    // release it -- otherwise the assertion below would be racing register
    // itself instead of proving it waited.
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseHeldTx();
    await holdingTx;

    await expect(registerPromise).rejects.toBeInstanceOf(CreatorEmailTakenError);

    const rows = await db
      .select()
      .from(creators)
      .where(and(eq(creators.userId, owner.id), eq(creators.organizationId, organization.id)));
    expect(rows).toHaveLength(1);
  });

  it("reuses an existing user by e-mail without changing it", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await org(db);
    const creator = await CreatorService.register(db, organization.id, { ...input, email: owner.email, fullName: "Outro Nome" });
    expect(creator.userId).toBe(owner.id);
    const [user] = await db.select().from(users).where(eq(users.id, owner.id));
    expect(user.fullName).toBe("Owner");
  });

  it("rejects an e-mail that already has a creator in the organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await org(db);
    await CreatorService.register(db, organization.id, input);
    await expect(CreatorService.register(db, organization.id, input)).rejects.toBeInstanceOf(CreatorEmailTakenError);
  });

  it("maps a concurrent insert of the same e-mail (unique violation) to CreatorEmailTakenError", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await org(db);
    await db.insert(users).values({ email: input.email, fullName: "Racer" });
    vi.spyOn(UsersRepository, "findByEmail").mockResolvedValueOnce(null);
    await expect(CreatorService.register(db, organization.id, input)).rejects.toBeInstanceOf(CreatorEmailTakenError);
  });

  it("updates only display fields and never another organization's creator", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await org(db, "A");
    const other = await org(db, "B");
    const creator = await CreatorService.register(db, organization.id, input);

    const updated = await CreatorService.update(db, organization.id, creator.id, { displayName: "Thais R.", instagramHandle: null });
    expect(updated).toMatchObject({ id: creator.id, displayName: "Thais R.", instagramHandle: null, userId: creator.userId });
    expect(await CreatorService.update(db, other.organization.id, creator.id, { displayName: "x", instagramHandle: null })).toBeNull();
  });

  it("lists with e-mail, sorted by display name", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await org(db);
    await CreatorService.register(db, organization.id, { ...input, displayName: "Zoe", email: "zoe@publyflow.test" });
    await CreatorService.register(db, organization.id, { ...input, displayName: "Ana", email: "ana@publyflow.test" });
    const list = await CreatorService.listWithEmail(db, organization.id);
    expect(list.map((c) => [c.displayName, c.email])).toEqual([
      ["Ana", "ana@publyflow.test"],
      ["Zoe", "zoe@publyflow.test"],
    ]);
  });
});
