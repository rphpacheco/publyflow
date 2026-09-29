import { describe, it, expect } from "vitest";
import { canManageOrganization, creatorScope, denyCreatorWrite, isCreator } from "./access";

const owner = { userId: "u", organizationId: "o", role: "OWNER" as const, creatorId: null };
const creator = { userId: "u", organizationId: "o", role: "CREATOR" as const, creatorId: "c1" };

describe("access helpers", () => {
  it("scope is the creator's id only for CREATOR", () => {
    expect(creatorScope(owner)).toBeNull();
    expect(creatorScope({ ...owner, role: "MANAGER" })).toBeNull();
    expect(creatorScope(creator)).toBe("c1");
  });

  it("isCreator / canManageOrganization", () => {
    expect(isCreator(creator)).toBe(true);
    expect(isCreator(owner)).toBe(false);
    expect(canManageOrganization("OWNER")).toBe(true);
    expect(canManageOrganization("MANAGER")).toBe(true);
    expect(canManageOrganization("CREATOR")).toBe(false);
  });

  it("denyCreatorWrite returns a 403 for CREATOR only", async () => {
    expect(denyCreatorWrite(owner)).toBeNull();
    const response = denyCreatorWrite(creator)!;
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Sem permissão." });
  });
});
