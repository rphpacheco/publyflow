import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Guards every future POST/PATCH/PUT/DELETE route under src/app/api against
// shipping without a CREATOR-write guard. `internal/` and `public/` routes
// are not session-gated the same way, so they're excluded.
const API_ROOT = path.resolve(__dirname);

const EXPORT_METHOD_RE = /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\b/g;
const REEXPORT_METHOD_RE = /export\s*\{[^}]*\bas\s+(POST|PATCH|PUT|DELETE)\b[^}]*\}/g;

const GUARD_RE = /denyCreatorWrite\(|canManageOrganization\(/;

// path (relative to src/app/api, posix-style) + method that is intentionally
// exempt from the guard requirement (see global-constraints.md).
const ALLOWLIST = new Set<string>(["inbox/messages/route.ts POST", "notifications/[id]/route.ts PATCH", "notifications/read-all/route.ts POST"]);

function listRouteFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "internal" || entry.name === "public") continue;
      files.push(...listRouteFiles(full));
    } else if (entry.isFile() && entry.name === "route.ts") {
      files.push(full);
    }
  }
  return files;
}

function methodsIn(source: string): string[] {
  const methods = new Set<string>();
  for (const match of source.matchAll(EXPORT_METHOD_RE)) methods.add(match[1]);
  for (const match of source.matchAll(REEXPORT_METHOD_RE)) methods.add(match[1]);
  return [...methods];
}

describe("every write route guards CREATOR", () => {
  const routeFiles = listRouteFiles(API_ROOT);
  // Sanity check: this test is worthless if the glob finds nothing.
  it("found route files to check", () => {
    expect(routeFiles.length).toBeGreaterThan(10);
  });

  for (const file of routeFiles) {
    const relativePath = path.relative(API_ROOT, file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");
    const methods = methodsIn(source);

    for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
      if (!methods.includes(method)) continue;
      const key = `${relativePath} ${method}`;
      if (ALLOWLIST.has(key)) continue;

      it(`${key} calls denyCreatorWrite or canManageOrganization`, () => {
        expect(GUARD_RE.test(source)).toBe(true);
      });
    }
  }
});
