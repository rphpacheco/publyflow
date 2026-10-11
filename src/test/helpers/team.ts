import { vi } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { TeamService } from "@/services/team.service";
import { users } from "@/db/schema/organizations";
import type { Session } from "@/lib/auth/types";

const hoisted = vi.hoisted(() => ({
  ensureAuthUserMock: vi.fn(async (_email: string): Promise<{ authUserId: string | null; created: boolean }> => ({
    authUserId: null,
    created: true,
  })),
}));
export const ensureAuthUserMock = hoisted.ensureAuthUserMock;

vi.mock("@/lib/auth/auth-admin", () => ({
  getAuthAdmin: () => ({ ensureAuthUser: ensureAuthUserMock, listAuthEmails: vi.fn() }),
}));

export function mockAuthAdmin() {
  vi.doMock("@/lib/auth/auth-admin", () => ({
    getAuthAdmin: () => ({ ensureAuthUser: ensureAuthUserMock, listAuthEmails: vi.fn() }),
  }));
}

export const ORIGIN = "http://localhost";

/** Org with an OWNER, an invited MANAGER, a CREATOR, plus a second org. */
export async function setupTeam() {
  ensureAuthUserMock.mockReset().mockResolvedValue({ authUserId: null, created: true });
  const { db, cleanup } = await withTestDb();
  const { organization, owner } = await OrganizationService.createWithOwner(db, {
    organizationName: "Org",
    ownerEmail: "owner@publyflow.test",
    ownerFullName: "Owner",
  });
  const other = await OrganizationService.createWithOwner(db, {
    organizationName: "Outra",
    ownerEmail: "outra@publyflow.test",
    ownerFullName: "Outra Dona",
  });
  const creator = await CreatorService.register(db, organization.id, {
    fullName: "Thais Rocha",
    displayName: "Thais",
    email: "thais@publyflow.test",
    instagramHandle: null,
  });
  const ownerSess = ownerSession(organization.id, owner.id);
  const invited = await TeamService.inviteManager(db, ownerSess, { fullName: "Ana Lima", email: "ana@publyflow.test" }, ORIGIN);
  const [managerUser] = await db.select().from(users).where(sql`lower(${users.email}) = 'ana@publyflow.test'`);
  const managerSess: Session = { organizationId: organization.id, userId: managerUser.id, role: "MANAGER", creatorId: null };
  const creatorSess: Session = { organizationId: organization.id, userId: owner.id, role: "CREATOR", creatorId: creator.id };
  const otherTeam = await TeamService.list(db, ownerSession(other.organization.id, other.owner.id));
  ensureAuthUserMock.mockClear();
  return {
    db,
    cleanup,
    organization,
    owner,
    ownerSess,
    managerSess,
    creatorSess,
    manager: invited.member,
    otherMembershipId: otherTeam[0].id,
  };
}
