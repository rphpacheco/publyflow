"use client";

import * as React from "react";
import type { SessionRole } from "@/lib/auth/types";

const SessionRoleContext = React.createContext<SessionRole | null>(null);

export function SessionRoleProvider({
  role,
  children,
}: {
  role: SessionRole;
  children: React.ReactNode;
}) {
  return <SessionRoleContext.Provider value={role}>{children}</SessionRoleContext.Provider>;
}

export function useSessionRole(): SessionRole {
  const role = React.useContext(SessionRoleContext);
  if (!role) {
    throw new Error("useSessionRole must be used within a SessionRoleProvider");
  }
  return role;
}

export function useIsCreator(): boolean {
  return useSessionRole() === "CREATOR";
}
