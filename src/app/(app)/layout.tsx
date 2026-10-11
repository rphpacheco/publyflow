import * as React from "react";
import { db } from "@/db";
import { PasswordChangedToast } from "@/components/shell/password-changed-toast";
import { CreatorService } from "@/services/creator.service";
import { requireAppSession } from "@/lib/auth/require-app-session";
import { CreatorProvider } from "@/components/shell/creator-context";
import { SessionRoleProvider } from "@/components/shell/session-role-context";
import { SidebarDesktop } from "@/components/shell/sidebar";
import { Header } from "@/components/shell/header";
import { SessionUnavailable } from "@/components/auth/session-unavailable";

// Reads the session cookie and the organization's creators on every request.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const result = await requireAppSession();
  if (result.status === "unavailable") return <SessionUnavailable />;
  const { session } = result;

  const allCreators = await CreatorService.listByOrganization(db, session.organizationId);
  const creators = allCreators
    .filter((c) => session.role !== "CREATOR" || c.id === session.creatorId)
    .map(({ id, displayName }) => ({ id, displayName }));

  return (
    <SessionRoleProvider role={session.role}>
      <React.Suspense fallback={null}>
        <PasswordChangedToast />
      </React.Suspense>
      <CreatorProvider organizationId={session.organizationId} creators={creators}>
        <div className="flex h-screen overflow-hidden">
          <SidebarDesktop />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Header />
            <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
          </div>
        </div>
      </CreatorProvider>
    </SessionRoleProvider>
  );
}
