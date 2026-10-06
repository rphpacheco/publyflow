import { describe, it, expect, vi } from "vitest";
import { createAuthAdmin } from "./auth-admin";
import { AuthProvisioningError } from "./errors";

function fakeClient(overrides: { createUser?: unknown; listUsers?: unknown } = {}) {
  const createUser = vi.fn(
    (overrides.createUser as never) ?? (async () => ({ data: { user: { id: "auth-1" } }, error: null })),
  );
  const listUsers = vi.fn(
    (overrides.listUsers as never) ?? (async () => ({ data: { users: [] }, error: null })),
  );
  return { client: { auth: { admin: { createUser, listUsers } } }, createUser, listUsers };
}

describe("createAuthAdmin.ensureAuthUser", () => {
  it("creates a confirmed user without password and returns its id", async () => {
    const { client, createUser } = fakeClient();
    const admin = createAuthAdmin(client as never);
    await expect(admin.ensureAuthUser("a@publyflow.test")).resolves.toEqual({ authUserId: "auth-1", created: true });
    expect(createUser).toHaveBeenCalledWith({ email: "a@publyflow.test", email_confirm: true });
  });

  it("passes the password through when given", async () => {
    const { client, createUser } = fakeClient();
    await createAuthAdmin(client as never).ensureAuthUser("a@publyflow.test", { password: "s3nha-forte" });
    expect(createUser).toHaveBeenCalledWith({ email: "a@publyflow.test", email_confirm: true, password: "s3nha-forte" });
  });

  it.each(["email_exists", "user_already_exists"])("treats %s as success without an id", async (code) => {
    const { client } = fakeClient({ createUser: async () => ({ data: { user: null }, error: { code, status: 422 } }) });
    await expect(createAuthAdmin(client as never).ensureAuthUser("a@publyflow.test")).resolves.toEqual({
      authUserId: null,
      created: false,
    });
  });

  it("throws AuthProvisioningError on any other error", async () => {
    const { client } = fakeClient({ createUser: async () => ({ data: { user: null }, error: { code: "unexpected_failure", status: 500 } }) });
    await expect(createAuthAdmin(client as never).ensureAuthUser("a@publyflow.test")).rejects.toBeInstanceOf(AuthProvisioningError);
  });

  it("throws AuthProvisioningError when the call itself throws", async () => {
    const { client } = fakeClient({ createUser: async () => { throw new TypeError("fetch failed"); } });
    await expect(createAuthAdmin(client as never).ensureAuthUser("a@publyflow.test")).rejects.toBeInstanceOf(AuthProvisioningError);
  });
});

describe("createAuthAdmin.listAuthEmails", () => {
  it("pages through all users and lower-cases e-mails", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ email: `U${i}@X.test` }));
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({ data: { users: page1 }, error: null })
      .mockResolvedValueOnce({ data: { users: [{ email: "Last@X.test" }, { email: null }] }, error: null });
    const { client } = fakeClient({ listUsers });
    const emails = await createAuthAdmin(client as never).listAuthEmails();
    expect(emails.size).toBe(1001);
    expect(emails.has("last@x.test")).toBe(true);
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 1000 });
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1000 });
  });
});
