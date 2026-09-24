// Transitional, development-only mechanism: no auth/session exists yet, so
// there's no way to derive the current organization from a request. Every
// component or API call that needs `organizationId` on the frontend must go
// through this single function -- never read
// `process.env.NEXT_PUBLIC_DEV_ORGANIZATION_ID` directly elsewhere. When
// authentication/session is implemented, this function's body is replaced
// with session-derived resolution; callers don't change.
//
// This is NOT a security boundary -- it does not provide tenant isolation by
// itself. Isolation is enforced by the backend (RLS + explicit
// organizationId predicates in every repository), the same as it is for any
// other caller of these APIs.
export function getDevOrganizationId(): string {
  const value = process.env.NEXT_PUBLIC_DEV_ORGANIZATION_ID;
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_DEV_ORGANIZATION_ID is not set. This is a development-only " +
        "transitional mechanism used until authentication/session is implemented -- " +
        "set it in .env.local to a real organization id from your local database.",
    );
  }
  return value;
}

// See getDevOrganizationId's doc comment above -- same transitional,
// development-only mechanism, for the current user's id. Every
// proposal-mutating API call requires an explicit userId (no auth/session
// exists yet); this is where the frontend sources it from until real auth
// lands.
export function getDevUserId(): string {
  const value = process.env.NEXT_PUBLIC_DEV_USER_ID;
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_DEV_USER_ID is not set. This is a development-only " +
        "transitional mechanism used until authentication/session is implemented -- " +
        "set it in .env.local to a real user id (an organization_members row) from your local database.",
    );
  }
  return value;
}
