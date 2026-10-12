import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Tenant data must be reached through runInTenantContext (which switches to the non-bypass role
// publyflow_app so RLS is enforced). This guard checks two things:
//  1. Repository methods whose FIRST parameter is the root connection `db` must open
//     runInTenantContext( in their body, unless allow-listed below as a system path.
//     `…WithTx(tx, …)` methods receive an already-scoped transaction and are skipped.
//     A method that only delegates to a compliant sibling (`XRepository.sibling(db` / `this.sibling(db`)
//     is compliant too (transitively, cycles are not compliant). Any first parameter not named `tx`
//     counts as a root connection. Non-allow-listed bodies must also not call db.<query>( directly.
//  2. Code under src/app, src/lib and src/services must not call db.select/insert/update/delete/execute/transaction
//     directly (except the privileged files below).
//
// Parser assumptions (kept simple on purpose): repositories declare methods as `async name(` or
// `name(` at 2-space indent inside `export const XRepository = { ... };`; the parameter list may span
// lines; the body is the first `{` after the parameter list (outside `<...>` of the return type),
// matched by brace counting after stripping comments.

const ROOT = path.resolve(__dirname, "../../..");
const REPO_DIR = path.join(ROOT, "src/repositories");

// "file#method" or "file#*" -> reason (system path: runs outside any single tenant on purpose).
const REPOSITORY_ALLOW_LIST = new Map<string, string>([
  ["users.repository.ts#findByAuthUserId", "global users table (no organization_id); session resolution"],
  ["users.repository.ts#findByEmail", "global users table; login linking by verified e-mail"],
  ["users.repository.ts#linkAuthUser", "global users table; provisioning/auth linking"],
  ["rate-limit.repository.ts#hit", "rate_limit_buckets is global infrastructure, keyed by IP/token"],
  ["rate-limit.repository.ts#purgeOlderThan", "rate_limit_buckets is global infrastructure"],
  ["organization-members.repository.ts#findOldestMembershipForUser", "privileged session resolution: the organization is what is being determined"],
  ["organization-members.repository.ts#recordLogin", "login-time write before any tenant context exists (login action / auth callbacks)"],
  ["proposals.repository.ts#findByPublicToken", "public proposal link: tenant unknown until the token is resolved"],
]);

// Files that may use the root connection directly (privileged, never switched to publyflow_app).
// Only files that actually contain a direct `db.<query>(` belong here (asserted below).
const DIRECT_DB_ALLOW_LIST = new Map<string, string>([
  ["src/services/organization.service.ts", "organization bootstrap: the tenant does not exist yet"],
  ["src/services/event-drain.service.ts", "cross-organization outbox drain"],
  ["src/lib/auth/provision-user.ts", "provisioning script"],
]);

function listFiles(dir: string, skip: (full: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (skip(full)) continue;
    if (entry.isDirectory()) out.push(...listFiles(full, skip));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function matchClose(src: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return i;
  }
  throw new Error(`unbalanced ${open}${close}`);
}

interface RepoMethod {
  file: string;
  name: string;
  firstParam: string;
  body: string;
}

const expected: Record<string, number> = {};

function parseMethods(file: string): RepoMethod[] {
  const src = stripComments(fs.readFileSync(path.join(REPO_DIR, file), "utf8"));
  const methods: RepoMethod[] = [];
  const objStart = /^export const \w+Repository\s*=\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = objStart.exec(src))) {
    const objOpen = src.indexOf("{", m.index);
    const objClose = matchClose(src, objOpen, "{", "}");
    const objSrc = src.slice(objOpen, objClose + 1);
    const methodRe = /^ {2}(?:async\s+)?(\w+)\s*\(/gm;
    let mm: RegExpExecArray | null;
    while ((mm = methodRe.exec(objSrc))) {
      const parenOpen = objSrc.indexOf("(", mm.index);
      const parenClose = matchClose(objSrc, parenOpen, "(", ")");
      const params = objSrc.slice(parenOpen + 1, parenClose);
      const firstParam = (params.match(/^\s*(\w+)/) ?? [])[1] ?? "";
      let angle = 0;
      let bodyOpen = -1;
      for (let i = parenClose + 1; i < objSrc.length; i++) {
        const c = objSrc[i];
        if (c === "<") angle++;
        else if (c === ">" && objSrc[i - 1] !== "=") angle--;
        else if (c === "{" && angle <= 0) {
          bodyOpen = i;
          break;
        }
      }
      if (bodyOpen < 0) throw new Error(`${file}#${mm[1]}: body not found`);
      const bodyClose = matchClose(objSrc, bodyOpen, "{", "}");
      methods.push({ file, name: mm[1], firstParam, body: objSrc.slice(bodyOpen, bodyClose + 1) });
      methodRe.lastIndex = bodyClose;
    }
    expected[file] = (expected[file] ?? 0) + (objSrc.match(/^ {2}(?:async\s+)?\w+\s*\(/gm) ?? []).length;
  }
  return methods;
}

const repoFiles = fs
  .readdirSync(REPO_DIR)
  .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && f !== "tenant-context.ts");
const allMethods = repoFiles.flatMap(parseMethods);
const rootDbMethods = allMethods.filter((x) => x.firstParam !== "tx");
const DIRECT_DB_RE = /\bdb\.(select|insert|update|delete|execute|transaction)\(/;

function isCompliant(x: RepoMethod, seen = new Set<string>()): boolean {
  if (x.body.includes("runInTenantContext(")) return true;
  const key = `${x.file}#${x.name}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const re = /(?:\w+Repository|this)\.(\w+)\(\s*db\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(x.body))) {
    const sib = allMethods.find((y) => y.file === x.file && y.name === m![1]);
    if (sib && isCompliant(sib, seen)) return true;
  }
  return false;
}

function allowed(x: RepoMethod): boolean {
  return REPOSITORY_ALLOW_LIST.has(`${x.file}#${x.name}`) || REPOSITORY_ALLOW_LIST.has(`${x.file}#*`);
}

describe("repository methods taking the root db open runInTenantContext", () => {
  it("parsed every method of every repository", () => {
    for (const f of repoFiles) {
      const parsed = allMethods.filter((x) => x.file === f).length;
      expect(parsed, `parse mismatch in ${f}`).toBe(expected[f] ?? 0);
    }
  });

  it("checked a meaningful number of methods", () => {
    expect(rootDbMethods.length).toBeGreaterThan(20);
  });

  it("has no stale allow-list entries", () => {
    for (const key of REPOSITORY_ALLOW_LIST.keys()) {
      const [file, name] = key.split("#");
      const exists = rootDbMethods.some((x) => x.file === file && (name === "*" || x.name === name));
      expect(exists, `stale allow-list entry ${key}`).toBe(true);
    }
  });

  for (const x of rootDbMethods) {
    if (allowed(x)) continue;
    it(`${x.file}#${x.name}`, () => {
      expect(isCompliant(x), `${x.file}#${x.name} takes the root db but never calls runInTenantContext(`).toBe(true);
      expect(x.body, `${x.file}#${x.name} queries db directly`).not.toMatch(DIRECT_DB_RE);
    });
  }
});

describe("no direct root-db access in src/app, src/lib and src/services", () => {
  const files = [
    ...listFiles(path.join(ROOT, "src/app")),
    ...listFiles(path.join(ROOT, "src/services")),
    ...listFiles(path.join(ROOT, "src/lib"), (full) => full === path.join(ROOT, "src/lib/supabase")),
  ];

  it("has no stale allow-list entries", () => {
    for (const rel of DIRECT_DB_ALLOW_LIST.keys()) {
      expect(fs.existsSync(path.join(ROOT, rel)), `stale allow-list entry ${rel}`).toBe(true);
    }
  });

  it("every allow-list entry still contains a direct db.<query>( call", () => {
    for (const rel of DIRECT_DB_ALLOW_LIST.keys()) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      expect(src, `unnecessary allow-list entry ${rel}`).toMatch(DIRECT_DB_RE);
    }
  });

  // A root `db` handed to a `…WithTx` method would run unscoped (no tenant context, no publyflow_app).
  const ROOT_DB_TO_WITHTX_RE = /\w+Repository\.\w+WithTx\(\s*db\b/m;
  const ROOT_DB_TO_WITHTX_ALLOW_LIST = new Set<string>();

  for (const file of files) {
    const rel0 = path.relative(ROOT, file).split(path.sep).join("/");
    if (ROOT_DB_TO_WITHTX_ALLOW_LIST.has(rel0)) continue;
    it(`${rel0} does not pass the root db to a ...WithTx method`, () => {
      expect(stripComments(fs.readFileSync(file, "utf8"))).not.toMatch(ROOT_DB_TO_WITHTX_RE);
    });
  }

  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (DIRECT_DB_ALLOW_LIST.has(rel)) continue;
    it(`${rel} does not call db.<query>() directly`, () => {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      expect(src).not.toMatch(DIRECT_DB_RE);
    });
  }
});
