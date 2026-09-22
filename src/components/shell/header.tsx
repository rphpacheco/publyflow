import { SidebarMobile } from "./sidebar";
import { CreatorSwitcher } from "./creator-switcher";

export function Header() {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4">
      <SidebarMobile />
      <div className="flex-1" />
      <CreatorSwitcher />
    </header>
  );
}
