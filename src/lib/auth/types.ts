export type SessionRole = "OWNER" | "MANAGER" | "CREATOR";

export interface Session {
  userId: string;
  organizationId: string;
  role: SessionRole;
  creatorId: string | null;
}

export interface AuthUserIdentity {
  id: string;
  email: string | undefined;
  emailVerified: boolean;
}
