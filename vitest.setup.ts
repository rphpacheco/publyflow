import { config } from "dotenv";

// Load .env.test first (test-specific overrides), then fall back to .env
// for any variables not already set (e.g. shell-exported values). Vars
// already present in process.env (e.g. from CI) are never overwritten.
config({ path: ".env.test" });
config({ path: ".env" });

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// @testing-library/react only auto-registers its afterEach(cleanup) when it
// detects a global `afterEach` (e.g. vitest's `globals: true`), which this
// project doesn't enable. Without it, a component tree rendered in one test
// stays mounted into the next test in the same file, and queries like
// getByText can start matching leftover elements from a prior render. This
// call is what @testing-library/react's own auto-cleanup would otherwise do.
afterEach(() => {
  cleanup();
});

// Radix primitives (Dialog, DropdownMenu, Popover, Command in later tasks)
// call pointer-capture and scroll APIs that jsdom doesn't implement. This is
// the standard jsdom+Radix+vitest workaround -- harmless no-op under the
// "node" environment backend tests run in, since `window` doesn't exist there.
if (typeof window !== "undefined") {
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
  // cmdk (Command Palette, Task 11) observes element size via ResizeObserver,
  // which jsdom doesn't implement either.
  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // jsdom doesn't implement matchMedia at all. Components that pick between
  // breakpoint-gated presentations (e.g. CommandPalette's Dialog-vs-Sheet)
  // read `window.innerWidth` against the query's max-width each time
  // `.matches` is read, so tests can simulate a viewport by setting
  // `window.innerWidth` before rendering.
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => {
      const match = /\(max-width:\s*(\d+)px\)/.exec(query);
      const maxWidth = match ? Number(match[1]) : Infinity;
      const mql: MediaQueryList = {
        get matches() {
          return window.innerWidth <= maxWidth;
        },
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
      return mql;
    };
  }
}
