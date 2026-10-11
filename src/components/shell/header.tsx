import { SidebarMobile } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { CreatorSwitcher } from "./creator-switcher";
import { NotificationsBell } from "./notifications-bell";
import { SignOutButton } from "@/components/auth/sign-out-button";

export function Header() {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4">
      <SidebarMobile />
      <CommandPalette />
      <div className="flex-1" />
      <NotificationsBell />
      <CreatorSwitcher />
      <SignOutButton label="Sair" variant="ghost" size="sm" />
    </header>
  );
}
