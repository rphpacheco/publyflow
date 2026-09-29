import { describe, it, expect, vi } from "vitest";
import type { Session } from "./types";

const isInCreatorScope = vi.fn();
vi.mock("@/repositories/proposals.repository", () => ({
  ProposalsRepository: { isInCreatorScope: (...args: unknown[]) => isInCreatorScope(...args) },
}));

import { proposalOutOfScope } from "./proposal-scope";

const db = {} as never;
const owner: Session = { userId: "u", organizationId: "o", role: "OWNER", creatorId: null };
const creatorOwn: Session = { userId: "u", organizationId: "o", role: "CREATOR", creatorId: "c1" };
const creatorOther: Session = { userId: "u", organizationId: "o", role: "CREATOR", creatorId: "c2" };

describe("proposalOutOfScope", () => {
  it("OWNER: never out of scope, no repository call", async () => {
    expect(await proposalOutOfScope(db, owner, "p1")).toBe(false);
    expect(isInCreatorScope).not.toHaveBeenCalled();
  });

  it("CREATOR viewing its own proposal: in scope", async () => {
    isInCreatorScope.mockResolvedValueOnce(true);
    expect(await proposalOutOfScope(db, creatorOwn, "p1")).toBe(false);
    expect(isInCreatorScope).toHaveBeenCalledWith(db, "o", "p1", "c1");
  });

  it("CREATOR viewing another creator's proposal: out of scope", async () => {
    isInCreatorScope.mockResolvedValueOnce(false);
    expect(await proposalOutOfScope(db, creatorOther, "p1")).toBe(true);
    expect(isInCreatorScope).toHaveBeenCalledWith(db, "o", "p1", "c2");
  });
});
