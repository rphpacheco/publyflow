import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { db } from "@/db";
import { CreatorService } from "@/services/creator.service";
import { getDevOrganizationId } from "@/lib/organization";
import { CreatorProvider } from "@/components/shell/creator-context";
import { SidebarDesktop } from "@/components/shell/sidebar";
import { Header } from "@/components/shell/header";
import { Toaster } from "sonner";

// Every route under this layout reads the current organization's creators
// via a live DB call (through CreatorService). Next must not attempt to
// prerender this at build time -- there's no guarantee a reachable Postgres
// or NEXT_PUBLIC_DEV_ORGANIZATION_ID exists in a build environment, and this
// data is inherently per-request anyway (it will become per-session once
// auth exists).
export const dynamic = "force-dynamic";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PublyFlow",
  description: "Gestão comercial para creators e assessorias",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const organizationId = getDevOrganizationId();
  const creators = await CreatorService.listByOrganization(db, organizationId);

  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <CreatorProvider organizationId={organizationId} creators={creators}>
          <div className="flex h-screen overflow-hidden">
            <SidebarDesktop />
            <div className="flex flex-1 flex-col overflow-hidden">
              <Header />
              <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
            </div>
          </div>
        </CreatorProvider>
        <Toaster />
      </body>
    </html>
  );
}
