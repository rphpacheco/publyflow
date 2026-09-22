import { config } from "dotenv";

// Load .env.test first (test-specific overrides), then fall back to .env
// for any variables not already set (e.g. shell-exported values). Vars
// already present in process.env (e.g. from CI) are never overwritten.
config({ path: ".env.test" });
config({ path: ".env" });

import "@testing-library/jest-dom/vitest";

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
}
