import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// API routes must read the session through getRouteSession() so a Supabase
// outage answers 503 AUTH_UNAVAILABLE instead of crashing or claiming 401.
const API_ROOT = path.resolve(__dirname);

function listRouteFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listRouteFiles(full));
    else if (entry.isFile() && entry.name === "route.ts") files.push(full);
  }
  return files;
}

describe("API routes read the session through getRouteSession()", () => {
  const routeFiles = listRouteFiles(API_ROOT);

  it("found route files to check", () => {
    expect(routeFiles.length).toBeGreaterThan(10);
  });

  for (const file of routeFiles) {
    const relativePath = path.relative(API_ROOT, file).split(path.sep).join("/");
    it(`${relativePath} does not call getSession() directly`, () => {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(/\bgetSession\s*\(/);
      expect(source).not.toMatch(/from\s+["']@\/lib\/auth\/session["']/);
    });
  }
});
