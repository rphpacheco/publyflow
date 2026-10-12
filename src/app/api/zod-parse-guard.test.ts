import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Route handlers must validate with safeParse (-> 400 { errors }); a throwing schema.parse(...) or a bare
// request.json() inside parse() turns invalid input into a 500.
const API_ROOT = path.resolve(__dirname);

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(full));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe("API routes validate input with safeParse", () => {
  const sourceFiles = listSourceFiles(API_ROOT);

  it("found source files to check", () => {
    expect(sourceFiles.length).toBeGreaterThan(10);
  });

  for (const file of sourceFiles) {
    const relativePath = path.relative(API_ROOT, file).split(path.sep).join("/");
    it(`${relativePath} uses safeParse and a guarded request.json()`, () => {
      const source = fs
        .readFileSync(file, "utf8")
        .replace(/JSON\.parse\(/g, "")
        .replace(/\.safeParse(Async)?\(/g, "");
      expect(source).not.toMatch(/\.parse(Async)?\(/);
      expect(source).not.toMatch(/request\.json\(\)(?!\s*\.catch)/);
    });
  }
});
