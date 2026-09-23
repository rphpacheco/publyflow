"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SIDEBAR_NAV_ITEMS } from "./sidebar";

// Mirrors Tailwind's `md` breakpoint (768px): below it we're in the "mobile"
// range that should get the full-screen-ish Sheet instead of the centered
// Dialog. No shared media-query hook exists in this codebase yet, so this
// stays a small inline hook local to this component rather than a new
// reusable module.
const MOBILE_QUERY = "(max-width: 767px)";

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mql.matches);
    const listener = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, []);

  return isMobile;
}

function CommandPaletteContent({ goTo }: { goTo: (href: string) => void }) {
  return (
    <Command>
      <CommandInput placeholder="Buscar ou executar um comando..." />
      <CommandList>
        <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
        <CommandGroup heading="Navegar">
          {SIDEBAR_NAV_ITEMS.map((item) => (
            <CommandItem key={item.href} onSelect={() => goTo(item.href)}>
              <item.icon className="size-4" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const isMobile = useIsMobileViewport();

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isModifierPressed = event.metaKey || event.ctrlKey;
      if (isModifierPressed && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function goTo(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 text-muted-foreground md:inline-flex"
      >
        <Search className="size-4" />
        <span>Buscar...</span>
        <kbd className="ml-4 rounded-sm border border-border bg-muted px-1.5 text-xs">⌘K</kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Abrir busca"
        className="size-11 md:hidden"
      >
        <Search className="size-5" />
      </Button>
      {/* Desktop/tablet (md+): centered Dialog. Only one of Dialog/Sheet is
          ever actually `open` at a time (gated by `isMobile`) -- opening both
          simultaneously would leave two stacked Radix modals, and Radix
          disables pointer-events on the non-topmost one. */}
      <Dialog open={open && !isMobile} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-0">
          <DialogTitle className="sr-only">Command Palette</DialogTitle>
          <CommandPaletteContent goTo={goTo} />
        </DialogContent>
      </Dialog>
      {/* Mobile (below md): full-screen-ish bottom Sheet, per spec. */}
      <Sheet open={open && isMobile} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] p-0">
          <SheetTitle className="sr-only">Command Palette</SheetTitle>
          <CommandPaletteContent goTo={goTo} />
        </SheetContent>
      </Sheet>
    </>
  );
}
