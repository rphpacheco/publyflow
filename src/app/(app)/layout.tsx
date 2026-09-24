import { redirect } from "next/navigation";
import { db } from "@/db";
import { CreatorService } from "@/services/creator.service";
import { getSession } from "@/lib/auth/session";
import { CreatorProvider } from "@/components/shell/creator-context";
import { SidebarDesktop } from "@/components/shell/sidebar";
import { Header } from "@/components/shell/header";

// Reads the session cookie and the organization's creators on every request.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    // src/proxy.ts already sent unauthenticated visitors to /login, so a null
    // session here means a Supabase user without PublyFlow access.
    redirect("/auth/signout?reason=no-access");
  }

  const creators = await CreatorService.listByOrganization(db, session.organizationId);

  return (
    <CreatorProvider organizationId={session.organizationId} creators={creators}>
      <div className="flex h-screen overflow-hidden">
        <SidebarDesktop />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </CreatorProvider>
  );
}
