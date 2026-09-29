"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Contact,
  FileText,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Menu,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsCreator } from "@/components/shell/session-role-context";

export interface SidebarNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

// Top-level product areas only -- labels, icons, and routes. No page content
// or screen-specific UX is implied here; each area gets its own spec later.
export const SIDEBAR_NAV_ITEMS: SidebarNavItem[] = [
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Pipeline", href: "/pipeline", icon: KanbanSquare },
  { label: "Creators", href: "/creators", icon: Users },
  { label: "Proposals", href: "/proposals", icon: FileText },
  { label: "Companies", href: "/companies", icon: Building2 },
  { label: "Contacts", href: "/contacts", icon: Contact },
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
];

const CREATOR_ALLOWED_HREFS = new Set(["/inbox", "/pipeline", "/proposals"]);

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isCreator = useIsCreator();
  const items = isCreator
    ? SIDEBAR_NAV_ITEMS.filter((item) => CREATOR_ALLOWED_HREFS.has(item.href))
    : SIDEBAR_NAV_ITEMS;
  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            onClick={onNavigate}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-md px-3 py-3 text-sm font-medium transition-colors",
              isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {/* Hidden at tablet width (md, icon-only rail), visible on
                mobile (default) and desktop (lg+) -- see spec §4's Sidebar
                row: "Fixa, colapsável para ícones" at tablet. */}
            <span className="md:hidden lg:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarDesktop() {
  return (
    <aside className="hidden md:flex md:w-16 md:flex-col md:border-r md:border-border md:bg-card lg:w-60">
      <div className="hidden px-4 py-4 text-sm font-semibold tracking-wide text-muted-foreground lg:block">
        PUBLYFLOW
      </div>
      <SidebarNav />
    </aside>
  );
}

function SidebarMobile() {
  const [open, setOpen] = React.useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11 md:hidden" aria-label="Abrir menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetTitle className="sr-only">Navegação</SheetTitle>
        <div className="px-4 py-4 text-sm font-semibold tracking-wide text-muted-foreground">
          PUBLYFLOW
        </div>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

export { SidebarDesktop, SidebarMobile, SidebarNav };
