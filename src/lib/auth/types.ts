export type SessionRole = "OWNER" | "MANAGER" | "CREATOR";

export interface Session {
  userId: string;
  organizationId: string;
  role: SessionRole;
}

export interface AuthUserIdentity {
  id: string;
  email: string | undefined;
}
