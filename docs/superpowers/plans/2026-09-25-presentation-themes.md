# Presentation Themes (V1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a proposal into a presentable document in one of 6 Presentation Themes, and give the creator a full-screen preview (`/proposals/[id]/preview`) that compares themes without saving and applies one on demand.

**Architecture:** `template` is renamed to `theme` end to end (DB enum/column, API, hooks, UI). A pure `buildPresentation(snapshot, context)` turns a proposal snapshot into a `PresentationModel`; a server-free `PresentationRenderer` draws that model with shared sections (Cover, Text, Items, Total, Actions) styled by a typed registry of 6 `ThemeDefinition`s. The preview route is a Server Component (session + loader + `buildPresentation`) that hands the model to a Client Component `PreviewShell` (toolbar, theme selector via `?theme=`, apply via the existing `useUpdateProposal`, desktop/390px toggle).

**Tech Stack:** Next.js 16 App Router (route groups, `notFound`, `next/font/google`, native `history.replaceState`), React 19, Tailwind CSS v4 (container queries `@container` / `@xl:`), TanStack Query, Drizzle + Postgres, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-25-presentation-themes-design.md`

## Global Constraints

- **Read the Next.js 16 docs before Next-specific code** (`AGENTS.md`): `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md`, `.../03-file-conventions/not-found.md`, `.../02-components/font.md`, and `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` (section on `window.history.replaceState`).
- Theme values (enum `proposal_theme`): `PREMIUM`, `MINIMAL`, `EDITORIAL`, `FASHION`, `BEAUTY`, `CORPORATE`. UI labels (unchanged): Premium, Minimalista, Editorial, Moda, Beleza, Corporativo. UI field label: "Tema".
- No API, hook, component or page accepts or sends `organizationId`/`userId` as caller input (Auth v1). Organization comes only from the session.
- `buildPresentation()` is pure: no I/O, never calls `new Date()`; `issuedAt` comes from `context`, formatted in `pt-BR` with `timeZone: "America/Sao_Paulo"`. Money in BRL via `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })` with the non-breaking space normalized to a regular space (`R$ 2.500,00`).
- Everything under `src/components/presentation/` except `fonts.ts` must be server-free and next/font-free: no imports of `@/db`, services, repositories, `next/headers`, `next/font`, `server-only`. Only `src/app/(preview)/layout.tsx` imports `fonts.ts`.
- Responsive rules inside the rendered document use Tailwind **container queries** (`@container` on the renderer root, `@xl:` variants), never viewport breakpoints (`sm:`, `md:`), so the 390px "Celular" frame shows the real phone layout on a desktop screen. No horizontal scroll at 375px.
- The document never shows operational/builder messages (e.g. "Adicione itens…"); those live only in the preview toolbar.
- Portuguese UI copy.
- **Database rule:** implementers never run `drizzle-kit migrate`, `psql`, or anything writing to a database outside the Vitest suite. The controller applies migrations.
- Use `/opt/homebrew/bin/pnpm`. Full suite: `/opt/homebrew/bin/pnpm vitest run`. If DB tests time out under host load, rerun with `--testTimeout=60000 --hookTimeout=60000` before concluding anything is broken.
- Build: `OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build`
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/db/migrations/0016_rename_proposal_template_to_theme.sql` (+ journal, snapshot) | Rename enum and column |
| `src/lib/proposal-themes.ts` (renamed from `proposal-templates.ts`) | Theme/status value lists and labels |
| `src/lib/presentation/types.ts` | `PresentationSnapshotInput`, `PresentationContext`, `PresentationModel`, `PresentationItem`, `PresentationAction` |
| `src/lib/presentation/format.ts` | `formatBRL`, `formatIssuedAt` |
| `src/lib/presentation/build-presentation.ts` | Pure snapshot → model |
| `src/lib/presentation/theme-param.ts` | Parse `?theme=` |
| `src/lib/auth/require-app-session.ts` | Shared session gate for `(app)` and `(preview)` layouts |
| `src/services/proposal-presentation.service.ts` | Server loader: proposal + snapshot + creator + client name, org-scoped |
| `src/components/presentation/theme-types.ts` | `ThemeDefinition`, layouts, classes |
| `src/components/presentation/font-families.ts` | CSS `font-family` stacks referencing font variables |
| `src/components/presentation/themes/*.ts` | One `ThemeDefinition` per theme + `index.ts` registry `THEMES` |
| `src/components/presentation/sections.tsx` | Shared Cover / Text / Items / Total / Actions sections |
| `src/components/presentation/presentation-renderer.tsx` | Renderer root |
| `src/components/presentation/fonts.ts` | `next/font/google` loaders (preview layout only) |
| `src/components/presentation/preview-shell.tsx` | Client toolbar + renderer |
| `src/app/(preview)/layout.tsx`, `src/app/(preview)/proposals/[id]/preview/page.tsx` | Preview route |

---

### Task 1: Rename `template` → `theme` end to end

**Files:**
- Create: `src/db/migrations/0016_rename_proposal_template_to_theme.sql`, `src/db/migrations/meta/0016_snapshot.json` (generated, then patched), journal entry in `src/db/migrations/meta/_journal.json` (generated)
- Modify: `src/db/schema/proposals.ts`, `src/repositories/proposals.repository.ts`, `src/services/proposal.service.ts`, `src/services/proposal-version.service.ts`, `src/app/api/proposals/route.ts`, `src/app/api/proposals/[id]/route.ts`, `src/hooks/use-proposals.ts`, `src/hooks/use-proposal.ts`, `src/components/pipeline/opportunity-side-panel.tsx`, `src/app/(app)/proposals/[id]/page.tsx`
- Rename: `src/lib/proposal-templates.ts` → `src/lib/proposal-themes.ts`, `src/lib/proposal-templates.test.ts` → `src/lib/proposal-themes.test.ts`
- Modify tests: every test file listed by `grep -rln "template" src --include="*.test.ts*"` (repositories, services, api routes, db schema/rls tests, hooks, `opportunity-side-panel.test.tsx`)

**Interfaces:**
- Produces: DB enum `proposal_theme`, column `proposals.theme`; Drizzle `proposalThemeEnum` and `proposals.theme`; `Proposal["theme"]`.
- Produces (`src/lib/proposal-themes.ts`): `type ProposalTheme`, `PROPOSAL_THEMES: ProposalTheme[]`, `PROPOSAL_THEME_LABELS: Record<ProposalTheme, string>`, `type ProposalStatus`, `PROPOSAL_STATUS_LABELS` (status exports unchanged).
- Produces: `ProposalSnapshot.proposal` is `{ title: string; theme: string; status: string }`.
- Produces: API bodies use `theme` (`POST /api/proposals { opportunityId, title, theme }`, `PATCH /api/proposals/:id { title?, theme?, status? }`); hook inputs `CreateProposalInput.theme`, `UpdateProposalInput.theme`; `Proposal.theme` in `src/hooks/use-proposals.ts`.

Rename rules (apply to every non-migration file under `src/` that `grep -rn "template" src | grep -v db/migrations` lists — that command must print nothing at the end):
- identifiers: `template` → `theme`, `Template` → `Theme`, `TEMPLATE` → `THEME` (`ProposalTemplate` → `ProposalTheme`, `PROPOSAL_TEMPLATES` → `PROPOSAL_THEMES`, `PROPOSAL_TEMPLATE_LABELS` → `PROPOSAL_THEME_LABELS`, `proposalTemplateEnum` → `proposalThemeEnum`, `templateEnum` → `themeEnum`, `handleTemplateChange` → `handleThemeChange`, `setTemplate` → `setTheme`)
- import path `@/lib/proposal-templates` → `@/lib/proposal-themes`
- DB names: `pgEnum("proposal_template", …)` → `pgEnum("proposal_theme", …)`, column `proposalTemplateEnum("template")` → `proposalThemeEnum("theme")`
- UI copy: label text `Template` → `Tema`; `aria-label="Template"` → `aria-label="Tema"`; element ids `proposal-template` → `proposal-theme`, `new-proposal-template` → `new-proposal-theme`; placeholder `Selecionar template` → `Selecionar tema`; `Título e template podem ser ajustados depois.` → `Título e tema podem ser ajustados depois.`
- test names/describes: `"proposal templates"` → `"proposal themes"`, `"lists all 6 templates …"` → `"lists all 6 themes …"`; `getByRole("combobox", { name: "Template" })` → `{ name: "Tema" }`
- Do **not** touch files in `src/db/migrations/` other than the new 0016 files.

- [ ] **Step 1: Rename the lib file and its test, update the test first**

```bash
git mv src/lib/proposal-templates.ts src/lib/proposal-themes.ts
git mv src/lib/proposal-templates.test.ts src/lib/proposal-themes.test.ts
```

Replace `src/lib/proposal-themes.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { PROPOSAL_THEMES, PROPOSAL_THEME_LABELS, PROPOSAL_STATUS_LABELS } from "./proposal-themes";

describe("proposal themes", () => {
  it("lists all 6 themes with a Portuguese label each", () => {
    expect(PROPOSAL_THEMES).toEqual(["PREMIUM", "MINIMAL", "EDITORIAL", "FASHION", "BEAUTY", "CORPORATE"]);
    for (const theme of PROPOSAL_THEMES) {
      expect(PROPOSAL_THEME_LABELS[theme]).toBeTruthy();
    }
    expect(PROPOSAL_THEME_LABELS.PREMIUM).toBe("Premium");
    expect(PROPOSAL_THEME_LABELS.MINIMAL).toBe("Minimalista");
  });

  it("labels proposal statuses in Portuguese", () => {
    expect(PROPOSAL_STATUS_LABELS.DRAFT).toBe("Rascunho");
    expect(PROPOSAL_STATUS_LABELS.ARCHIVED).toBe("Arquivada");
  });
});
```

(Read the old test first and keep any assertion it had that isn't covered here.)

- [ ] **Step 2: Run it to see it fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/proposal-themes.test.ts`
Expected: FAIL — `PROPOSAL_THEMES` is not exported.

- [ ] **Step 3: Update `src/lib/proposal-themes.ts`**

```typescript
export type ProposalTheme = "PREMIUM" | "MINIMAL" | "EDITORIAL" | "FASHION" | "BEAUTY" | "CORPORATE";

export const PROPOSAL_THEMES: ProposalTheme[] = ["PREMIUM", "MINIMAL", "EDITORIAL", "FASHION", "BEAUTY", "CORPORATE"];

export const PROPOSAL_THEME_LABELS: Record<ProposalTheme, string> = {
  PREMIUM: "Premium",
  MINIMAL: "Minimalista",
  EDITORIAL: "Editorial",
  FASHION: "Moda",
  BEAUTY: "Beleza",
  CORPORATE: "Corporativo",
};

export type ProposalStatus = "DRAFT" | "ARCHIVED";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho",
  ARCHIVED: "Arquivada",
};
```

- [ ] **Step 4: Rename in the Drizzle schema and create the migration**

In `src/db/schema/proposals.ts`:

```typescript
export const proposalThemeEnum = pgEnum("proposal_theme", [
  "PREMIUM",
  "MINIMAL",
  "EDITORIAL",
  "FASHION",
  "BEAUTY",
  "CORPORATE",
]);
```

and in the `proposals` table: `theme: proposalThemeEnum("theme").notNull(),` (replacing the `template` line).

`drizzle-kit generate` asks interactively about renames, so create an empty custom migration instead:

```bash
/opt/homebrew/bin/pnpm drizzle-kit generate --custom --name rename_proposal_template_to_theme
```

It creates `src/db/migrations/0016_rename_proposal_template_to_theme.sql` (empty), a journal entry, and `meta/0016_snapshot.json` — a **copy of the previous snapshot** (still `proposal_template`/`template`). Write the SQL:

```sql
ALTER TYPE "public"."proposal_template" RENAME TO "proposal_theme";--> statement-breakpoint
ALTER TABLE "proposals" RENAME COLUMN "template" TO "theme";
```

Patch the snapshot so drizzle-kit sees the renamed schema (keeps column order):

```bash
python3 - <<'EOF'
import json
p = "src/db/migrations/meta/0016_snapshot.json"
s = json.load(open(p))
enum = s["enums"].pop("public.proposal_template")
enum["name"] = "proposal_theme"
s["enums"]["public.proposal_theme"] = enum
table = s["tables"]["public.proposals"]
cols = {}
for key, col in table["columns"].items():
    if key == "template":
        key = "theme"
        col = dict(col, name="theme", type="proposal_theme")
    cols[key] = col
table["columns"] = cols
with open(p, "w") as f:
    json.dump(s, f, indent=2)
    f.write("\n")
EOF
```

Verify drizzle-kit sees no pending change (it must not prompt):

```bash
/opt/homebrew/bin/pnpm drizzle-kit generate --name should_not_exist </dev/null
```

Expected output contains `No schema changes, nothing to migrate`. If it instead creates a `0017_*` file or prompts, stop and report BLOCKED with the output (delete any `0017_*` files and its journal entry first).

- [ ] **Step 5: STOP — hand off the migration to the controller**

Report status NEEDS_CONTEXT with the message "migration 0016 generated and snapshot patched, awaiting controller to apply". Do not commit yet. The controller applies it to the test and dev databases and resumes you.

- [ ] **Step 6: Apply the rename rules to all remaining files**

Apply the rename rules above to every file listed. Specific shapes after the change:

`src/services/proposal-version.service.ts`:
```typescript
export interface ProposalSnapshot {
  proposal: { title: string; theme: string; status: string };
  items: ProposalItem[];
  blocks: ProposalBlock[];
}
```
and `proposal: { title: proposal.title, theme: proposal.theme, status: proposal.status },`.

`src/services/proposal.service.ts` update check: `before.theme !== after.theme ||`.

`src/app/api/proposals/route.ts`: `const themeEnum = z.enum([...])`, schema field `theme: themeEnum`, service input `theme: payload.theme`. `src/app/api/proposals/[id]/route.ts`: `theme: themeEnum.optional()`.

`src/app/(app)/proposals/[id]/page.tsx` theme field:
```tsx
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="proposal-theme">
            Tema
          </label>
          <Select value={proposal.theme} onValueChange={handleThemeChange} disabled={readOnly}>
            <SelectTrigger id="proposal-theme" aria-label="Tema" className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROPOSAL_THEMES.map((item) => (
                <SelectItem key={item} value={item}>
                  {PROPOSAL_THEME_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
```
with `function handleThemeChange(value: string) { updateProposal.mutate({ theme: value as ProposalTheme }); }`.

- [ ] **Step 7: Confirm nothing is left and run everything**

```bash
grep -rn "template" src | grep -v "src/db/migrations/" || echo "clean"
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
```

Expected: `clean`; all tests pass; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A src
git status
git commit -m "refactor: rename proposal template to theme"
```

(`git status` must show only files under `src/`.)

---

### Task 2: Pure `buildPresentation`

**Files:**
- Create: `src/lib/presentation/types.ts`, `src/lib/presentation/format.ts`, `src/lib/presentation/build-presentation.ts`
- Test: `src/lib/presentation/build-presentation.test.ts`

**Interfaces:**
- Consumes: `ProposalTheme`, `PROPOSAL_THEMES` from `@/lib/proposal-themes` (Task 1).
- Produces (`types.ts`): `PresentationSnapshotInput`, `PresentationContext`, `PresentationItem`, `PresentationModel`, `PresentationAction` (exact shapes below). `ProposalSnapshot` from Task 1 is structurally assignable to `PresentationSnapshotInput`.
- Produces: `buildPresentation(snapshot: PresentationSnapshotInput, context: PresentationContext): PresentationModel`; `formatBRL(cents: number): string`; `formatIssuedAt(date: Date): string`.

- [ ] **Step 1: Create the types**

```typescript
// src/lib/presentation/types.ts
import type { ProposalTheme } from "@/lib/proposal-themes";

/**
 * The part of a proposal snapshot the presentation needs. `ProposalSnapshot`
 * (src/services/proposal-version.service.ts) is assignable to it, and so are
 * snapshots stored before the template -> theme rename (they carry
 * `template` instead of `theme`).
 */
export interface PresentationSnapshotInput {
  proposal: { title: string; status: string; theme?: string; template?: string };
  items: Array<{ description: string; quantity: number; unitPrice: number; sortOrder: number }>;
  blocks: Array<{ blockType: string; content: unknown }>;
}

export interface PresentationContext {
  creator: { displayName: string; instagramHandle: string | null };
  client: { name: string | null };
  /** Supplied by the caller: "now" for the preview, publication date later. */
  issuedAt: Date;
}

export interface PresentationItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  unitPriceLabel: string;
  subtotalLabel: string;
}

export interface PresentationModel {
  theme: ProposalTheme;
  title: string;
  headline: string;
  body: string | null;
  creator: { name: string; handle: string | null };
  clientName: string | null;
  items: PresentationItem[];
  totalCents: number;
  totalLabel: string;
  issuedAtLabel: string;
}

export type PresentationAction = "accept" | "request_changes" | "reject";
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/lib/presentation/build-presentation.test.ts
import { describe, it, expect } from "vitest";
import { buildPresentation } from "./build-presentation";
import { formatBRL, formatIssuedAt } from "./format";
import type { PresentationContext, PresentationSnapshotInput } from "./types";

const context: PresentationContext = {
  creator: { displayName: "Thais", instagramHandle: "@thais" },
  client: { name: "Bella Cosméticos" },
  issuedAt: new Date("2026-09-25T15:00:00Z"),
};

function snapshot(overrides: Partial<PresentationSnapshotInput> = {}): PresentationSnapshotInput {
  return {
    proposal: { title: "Campanha Verão", theme: "EDITORIAL", status: "DRAFT" },
    items: [
      { description: "Stories", quantity: 2, unitPrice: 80000, sortOrder: 1 },
      { description: "Reel patrocinado", quantity: 3, unitPrice: 250000, sortOrder: 0 },
    ],
    blocks: [
      { blockType: "COVER", content: { headline: "Verão com Bella" } },
      { blockType: "TEXT", content: { body: "Uma campanha de lançamento." } },
    ],
    ...overrides,
  };
}

describe("formatBRL / formatIssuedAt", () => {
  it("formats cents as BRL with a regular space", () => {
    expect(formatBRL(250000)).toBe("R$ 2.500,00");
    expect(formatBRL(0)).toBe("R$ 0,00");
    expect(formatBRL(12345678)).toBe("R$ 123.456,78");
  });

  it("formats the issue date in pt-BR, São Paulo time", () => {
    expect(formatIssuedAt(new Date("2026-09-25T15:00:00Z"))).toBe("25 de setembro de 2026");
    // 02:00 UTC on the 26th is still the 25th in São Paulo (UTC-3)
    expect(formatIssuedAt(new Date("2026-09-26T02:00:00Z"))).toBe("25 de setembro de 2026");
  });
});

describe("buildPresentation", () => {
  it("builds the model with items sorted, subtotals and total", () => {
    const model = buildPresentation(snapshot(), context);

    expect(model.theme).toBe("EDITORIAL");
    expect(model.title).toBe("Campanha Verão");
    expect(model.headline).toBe("Verão com Bella");
    expect(model.body).toBe("Uma campanha de lançamento.");
    expect(model.creator).toEqual({ name: "Thais", handle: "@thais" });
    expect(model.clientName).toBe("Bella Cosméticos");
    expect(model.items.map((item) => item.description)).toEqual(["Reel patrocinado", "Stories"]);
    expect(model.items[0]).toEqual({
      description: "Reel patrocinado",
      quantity: 3,
      unitPriceCents: 250000,
      subtotalCents: 750000,
      unitPriceLabel: "R$ 2.500,00",
      subtotalLabel: "R$ 7.500,00",
    });
    expect(model.totalCents).toBe(910000);
    expect(model.totalLabel).toBe("R$ 9.100,00");
    expect(model.issuedAtLabel).toBe("25 de setembro de 2026");
  });

  it("falls back to the title when the headline is empty", () => {
    const model = buildPresentation(
      snapshot({ blocks: [{ blockType: "COVER", content: { headline: "   " } }] }),
      context,
    );
    expect(model.headline).toBe("Campanha Verão");
  });

  it("returns a null body when the text block is empty or missing", () => {
    expect(buildPresentation(snapshot({ blocks: [{ blockType: "TEXT", content: { body: "" } }] }), context).body).toBeNull();
    expect(buildPresentation(snapshot({ blocks: [] }), context).body).toBeNull();
  });

  it("returns no items and a zero total when there are no items", () => {
    const model = buildPresentation(snapshot({ items: [] }), context);
    expect(model.items).toEqual([]);
    expect(model.totalCents).toBe(0);
    expect(model.totalLabel).toBe("R$ 0,00");
  });

  it("normalizes the creator handle and omits it when absent", () => {
    const bare = buildPresentation(snapshot(), { ...context, creator: { displayName: "Thais", instagramHandle: "thais" } });
    expect(bare.creator.handle).toBe("@thais");
    const none = buildPresentation(snapshot(), { ...context, creator: { displayName: "Thais", instagramHandle: null } });
    expect(none.creator.handle).toBeNull();
    const blank = buildPresentation(snapshot(), { ...context, creator: { displayName: "Thais", instagramHandle: " @ " } });
    expect(blank.creator.handle).toBeNull();
  });

  it("passes the client name through and turns a blank one into null", () => {
    expect(buildPresentation(snapshot(), { ...context, client: { name: null } }).clientName).toBeNull();
    expect(buildPresentation(snapshot(), { ...context, client: { name: "  " } }).clientName).toBeNull();
  });

  it("reads the theme from legacy snapshots that still carry `template`", () => {
    const model = buildPresentation(
      snapshot({ proposal: { title: "Antiga", template: "FASHION", status: "DRAFT" } }),
      context,
    );
    expect(model.theme).toBe("FASHION");
  });

  it("falls back to MINIMAL for an unknown or missing theme", () => {
    expect(buildPresentation(snapshot({ proposal: { title: "X", theme: "NEON", status: "DRAFT" } }), context).theme).toBe("MINIMAL");
    expect(buildPresentation(snapshot({ proposal: { title: "X", status: "DRAFT" } }), context).theme).toBe("MINIMAL");
  });

  it("is deterministic: the same input gives the same output", () => {
    expect(buildPresentation(snapshot(), context)).toEqual(buildPresentation(snapshot(), context));
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/presentation/build-presentation.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

```typescript
// src/lib/presentation/format.ts
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const issuedAtFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

/** 250000 -> "R$ 2.500,00" (regular space, not the NBSP Intl emits). */
export function formatBRL(cents: number): string {
  return brl.format(cents / 100).replace(/ /g, " ");
}

export function formatIssuedAt(date: Date): string {
  return issuedAtFormat.format(date);
}
```

```typescript
// src/lib/presentation/build-presentation.ts
import { PROPOSAL_THEMES, type ProposalTheme } from "@/lib/proposal-themes";
import { formatBRL, formatIssuedAt } from "./format";
import type {
  PresentationContext,
  PresentationItem,
  PresentationModel,
  PresentationSnapshotInput,
} from "./types";

const FALLBACK_THEME: ProposalTheme = "MINIMAL";

function resolveTheme(proposal: PresentationSnapshotInput["proposal"]): ProposalTheme {
  const raw = proposal.theme ?? proposal.template;
  return (PROPOSAL_THEMES as string[]).includes(raw ?? "") ? (raw as ProposalTheme) : FALLBACK_THEME;
}

function blockText(blocks: PresentationSnapshotInput["blocks"], blockType: string, key: string): string {
  const content = blocks.find((block) => block.blockType === blockType)?.content;
  if (content && typeof content === "object" && key in content) {
    const value = (content as Record<string, unknown>)[key];
    if (typeof value === "string") return value.trim();
  }
  return "";
}

function normalizeHandle(handle: string | null): string | null {
  const bare = (handle ?? "").trim().replace(/^@+/, "").trim();
  return bare ? `@${bare}` : null;
}

export function buildPresentation(
  snapshot: PresentationSnapshotInput,
  context: PresentationContext,
): PresentationModel {
  const items: PresentationItem[] = [...snapshot.items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => {
      const subtotalCents = item.unitPrice * item.quantity;
      return {
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPrice,
        subtotalCents,
        unitPriceLabel: formatBRL(item.unitPrice),
        subtotalLabel: formatBRL(subtotalCents),
      };
    });
  const totalCents = items.reduce((sum, item) => sum + item.subtotalCents, 0);
  const headline = blockText(snapshot.blocks, "COVER", "headline");
  const body = blockText(snapshot.blocks, "TEXT", "body");

  return {
    theme: resolveTheme(snapshot.proposal),
    title: snapshot.proposal.title,
    headline: headline || snapshot.proposal.title,
    body: body || null,
    creator: { name: context.creator.displayName, handle: normalizeHandle(context.creator.instagramHandle) },
    clientName: context.client.name?.trim() || null,
    items,
    totalCents,
    totalLabel: formatBRL(totalCents),
    issuedAtLabel: formatIssuedAt(context.issuedAt),
  };
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/presentation/build-presentation.test.ts`
Expected: PASS (11 tests). If the date/currency strings differ, check Node's ICU (`node -p "Intl.DateTimeFormat().resolvedOptions().locale"`) and report instead of loosening the assertions.

- [ ] **Step 6: Full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/lib/presentation
git commit -m "feat: add pure buildPresentation for proposal themes"
```

---

### Task 3: Shared `requireAppSession()` for app layouts

**Files:**
- Create: `src/lib/auth/require-app-session.ts`
- Modify: `src/app/(app)/layout.tsx`
- Test: `src/lib/auth/require-app-session.test.ts`

**Interfaces:**
- Consumes: `getSession(): Promise<Session | null>` from `./session` (Auth v1).
- Produces: `requireAppSession(): Promise<Session>` — returns the session, or calls `redirect("/auth/signout?reason=no-access")` when it is null. Used by `(app)` (this task) and `(preview)` (Task 7).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/auth/require-app-session.test.ts
import { describe, it, expect, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect:${url}`);
  }
}

async function importWithSession(session: unknown) {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  }));
  vi.doMock("./session", () => ({ getSession: async () => session }));
  return import("./require-app-session");
}

describe("requireAppSession", () => {
  it("returns the session when there is one", async () => {
    const session = { userId: "u1", organizationId: "o1", role: "OWNER" };
    const { requireAppSession } = await importWithSession(session);
    await expect(requireAppSession()).resolves.toEqual(session);
  });

  it("sends an authenticated user without PublyFlow access to the no-access sign-out", async () => {
    const { requireAppSession } = await importWithSession(null);
    await expect(requireAppSession()).rejects.toMatchObject({ url: "/auth/signout?reason=no-access" });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/auth/require-app-session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement and use it in the `(app)` layout**

```typescript
// src/lib/auth/require-app-session.ts
import { redirect } from "next/navigation";
import { getSession } from "./session";
import type { Session } from "./types";

/**
 * Session gate for the authenticated app layouts ((app) and (preview)).
 * src/proxy.ts already sent visitors without a Supabase user to /login, so a
 * null session here means a Supabase user without PublyFlow access: sign
 * them out and show /sem-acesso.
 */
export async function requireAppSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect("/auth/signout?reason=no-access");
  }
  return session;
}
```

In `src/app/(app)/layout.tsx` replace the `getSession` import and the null check with:

```tsx
import { requireAppSession } from "@/lib/auth/require-app-session";
// ...
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAppSession();
  const creators = await CreatorService.listByOrganization(db, session.organizationId);
  // ... rest unchanged
```

(Remove the now-unused `redirect` and `getSession` imports and the old comment.)

- [ ] **Step 4: Run it to see it pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/auth/require-app-session.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/lib/auth/require-app-session.ts src/lib/auth/require-app-session.test.ts "src/app/(app)/layout.tsx"
git commit -m "refactor: extract requireAppSession for app layouts"
```

---

### Task 4: Organization-scoped preview loader

**Files:**
- Modify: `src/repositories/creators.repository.ts`, `src/repositories/companies.repository.ts`, `src/repositories/brands.repository.ts` (add `findByIdWithTx`)
- Modify: `src/services/proposal-version.service.ts` (expose `buildSnapshotWithTx`)
- Create: `src/services/proposal-presentation.service.ts`
- Test: `src/services/proposal-presentation.service.test.ts`

**Interfaces:**
- Consumes: `ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId)`, `OpportunitiesRepository.findByIdWithTx(tx, organizationId, opportunityId)`, `runInTenantContext` (existing); `ProposalSnapshot` with `theme` (Task 1).
- Produces: `CreatorsRepository.findByIdWithTx(tx, organizationId, creatorId): Promise<Creator | null>`, `CompaniesRepository.findByIdWithTx(tx, organizationId, companyId): Promise<Company | null>`, `BrandsRepository.findByIdWithTx(tx, organizationId, brandId): Promise<Brand | null>` — each filters by `id` **and** `organization_id`.
- Produces: `ProposalVersionService.buildSnapshotWithTx(tx, organizationId, proposalId): Promise<ProposalSnapshot>` (the existing private function, now also exposed on the service object).
- Produces (`src/services/proposal-presentation.service.ts`):
  ```typescript
  export interface PreviewSource {
    snapshot: ProposalSnapshot;
    status: ProposalStatus;        // from @/lib/proposal-themes
    creator: { displayName: string; instagramHandle: string | null };
    clientName: string | null;     // brand name, else company name, else null
  }
  export const ProposalPresentationService: {
    loadPreviewSource(db, organizationId: string, proposalId: string): Promise<PreviewSource | null>;
  };
  ```
  Returns `null` when `proposalId` is not a UUID, the proposal doesn't exist, or it belongs to another organization.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/proposal-presentation.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ProposalService } from "./proposal.service";
import { ProposalPresentationService } from "./proposal-presentation.service";
import { brands, companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("ProposalPresentationService.loadPreviewSource", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(
    db: NodePgDatabase<typeof schema>,
    options: { withCompany?: boolean; withBrand?: boolean } = {},
  ) {
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Thais",
      displayName: "Thais",
      instagramHandle: "@thais",
    });
    const [company] = options.withCompany
      ? await db.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }).returning()
      : [null];
    const [brand] = options.withBrand
      ? await db
          .insert(brands)
          .values({ organizationId: organization.id, companyId: company?.id ?? null, name: "Bella Summer" })
          .returning()
      : [null];
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({
        organizationId: organization.id,
        creatorId: creator.id,
        leadId: lead.id,
        companyId: company?.id ?? null,
        brandId: brand?.id ?? null,
      })
      .returning();
    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      theme: "EDITORIAL",
      userId: owner.id,
    });
    return { organization, proposal };
  }

  it("loads the draft snapshot, status, creator and brand name", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await setup(db, { withCompany: true, withBrand: true });

    const source = await ProposalPresentationService.loadPreviewSource(db, organization.id, proposal.id);

    expect(source).not.toBeNull();
    expect(source!.snapshot.proposal).toEqual({ title: "Campanha Verão", theme: "EDITORIAL", status: "DRAFT" });
    expect(source!.snapshot.blocks.map((block) => block.blockType).sort()).toEqual(["COVER", "TEXT"]);
    expect(source!.status).toBe("DRAFT");
    expect(source!.creator).toEqual({ displayName: "Thais", instagramHandle: "@thais" });
    expect(source!.clientName).toBe("Bella Summer");
  });

  it("uses the company name when there is no brand, and null when neither exists", async () => {
    const withCompany = await withTestDb();
    cleanup = withCompany.cleanup;
    const a = await setup(withCompany.db, { withCompany: true });
    expect((await ProposalPresentationService.loadPreviewSource(withCompany.db, a.organization.id, a.proposal.id))!.clientName).toBe(
      "Bella Cosméticos",
    );
    await withCompany.cleanup();

    const neither = await withTestDb();
    cleanup = neither.cleanup;
    const b = await setup(neither.db);
    expect((await ProposalPresentationService.loadPreviewSource(neither.db, b.organization.id, b.proposal.id))!.clientName).toBeNull();
  });

  it("returns null for a proposal of another organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { proposal } = await setup(db);
    const { organization: other } = await OrganizationService.createWithOwner(db, {
      organizationName: "Outra",
      ownerEmail: `other-${Date.now()}@publyflow.test`,
      ownerFullName: "Other",
    });

    expect(await ProposalPresentationService.loadPreviewSource(db, other.id, proposal.id)).toBeNull();
  });

  it("returns null for an unknown id and for a non-UUID id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await setup(db);

    expect(
      await ProposalPresentationService.loadPreviewSource(db, organization.id, "00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
    expect(await ProposalPresentationService.loadPreviewSource(db, organization.id, "not-a-uuid")).toBeNull();
  });
});
```

(Read `src/services/creator.service.ts` to confirm `OnboardCreatorInput` accepts `instagramHandle`, and `src/db/schema/companies-brands-contacts.ts` for the `brands` columns; adapt field names if they differ and note it.)

- [ ] **Step 2: Run it to see it fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/services/proposal-presentation.service.test.ts`
Expected: FAIL — `./proposal-presentation.service` not found.

- [ ] **Step 3: Add the repository lookups**

Add to each repository object (read the file first; reuse its existing imports, `Creator`/`Company`/`Brand` type names and table imports; add `and`/`eq` to the `drizzle-orm` import if missing):

```typescript
  // CreatorsRepository
  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<Creator | null> {
    const [row] = await tx
      .select()
      .from(creators)
      .where(and(eq(creators.id, creatorId), eq(creators.organizationId, organizationId)));
    return row ?? null;
  },
```

```typescript
  // CompaniesRepository
  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    companyId: string,
  ): Promise<Company | null> {
    const [row] = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.organizationId, organizationId)));
    return row ?? null;
  },
```

```typescript
  // BrandsRepository
  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    brandId: string,
  ): Promise<Brand | null> {
    const [row] = await tx
      .select()
      .from(brands)
      .where(and(eq(brands.id, brandId), eq(brands.organizationId, organizationId)));
    return row ?? null;
  },
```

If a repository has no exported row type yet, add one next to its other types (e.g. `export type Brand = typeof brands.$inferSelect;`).

- [ ] **Step 4: Expose `buildSnapshotWithTx`**

In `src/services/proposal-version.service.ts`, add to the `ProposalVersionService` object:

```typescript
  /** The snapshot of the proposal's current state (same shape versions store). */
  async buildSnapshotWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalSnapshot> {
    return buildSnapshotWithTx(tx, organizationId, proposalId);
  },
```

- [ ] **Step 5: Implement the loader**

```typescript
// src/services/proposal-presentation.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { CompaniesRepository } from "@/repositories/companies.repository";
import { BrandsRepository } from "@/repositories/brands.repository";
import { ProposalVersionService, type ProposalSnapshot } from "./proposal-version.service";
import type { ProposalStatus } from "@/lib/proposal-themes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PreviewSource {
  snapshot: ProposalSnapshot;
  status: ProposalStatus;
  creator: { displayName: string; instagramHandle: string | null };
  clientName: string | null;
}

async function resolveClientName(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  brandId: string | null,
  companyId: string | null,
): Promise<string | null> {
  if (brandId) {
    const brand = await BrandsRepository.findByIdWithTx(tx, organizationId, brandId);
    if (brand) return brand.name;
  }
  if (companyId) {
    const company = await CompaniesRepository.findByIdWithTx(tx, organizationId, companyId);
    if (company) return company.name;
  }
  return null;
}

export const ProposalPresentationService = {
  /**
   * Everything the preview page needs, scoped to the session's organization.
   * Null when the id is malformed, unknown, or belongs to another
   * organization -- the page turns that into a 404 without revealing which.
   */
  async loadPreviewSource(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<PreviewSource | null> {
    if (!UUID.test(proposalId)) return null;

    return runInTenantContext(db, organizationId, async (tx) => {
      const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
      if (!proposal) return null;

      const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, proposal.opportunityId);
      if (!opportunity) return null;

      const creator = await CreatorsRepository.findByIdWithTx(tx, organizationId, opportunity.creatorId);
      if (!creator) return null;

      const clientName = await resolveClientName(tx, organizationId, opportunity.brandId, opportunity.companyId);
      const snapshot = await ProposalVersionService.buildSnapshotWithTx(tx, organizationId, proposalId);

      return {
        snapshot,
        status: proposal.status,
        creator: { displayName: creator.displayName, instagramHandle: creator.instagramHandle },
        clientName,
      };
    });
  },
};
```

- [ ] **Step 6: Run it to see it pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/services/proposal-presentation.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/repositories src/services
git commit -m "feat: add organization-scoped proposal preview loader"
```

---

### Task 5: Presentation renderer and the 6 themes

**Files:**
- Create: `src/components/presentation/theme-types.ts`, `src/components/presentation/font-families.ts`, `src/components/presentation/themes/{premium,minimal,editorial,fashion,beauty,corporate}.ts`, `src/components/presentation/themes/index.ts`, `src/components/presentation/sections.tsx`, `src/components/presentation/presentation-renderer.tsx`
- Test: `src/components/presentation/themes/index.test.ts`, `src/components/presentation/presentation-renderer.test.tsx`

**Interfaces:**
- Consumes: `PresentationModel`, `PresentationItem`, `PresentationAction` (Task 2); `ProposalTheme`, `PROPOSAL_THEMES` (Task 1); `cn` from `@/lib/utils`.
- Produces: `THEMES: Record<ProposalTheme, ThemeDefinition>`; `PresentationRenderer({ model, theme?, onAction? })` — `theme` overrides `model.theme` (used by the preview to compare without rebuilding the model); without `onAction` the three action buttons are inert (`aria-disabled="true"`, no handler). Font CSS variables it expects on an ancestor: `--font-inter` (root layout) and `--font-pf-cormorant`, `--font-pf-fraunces`, `--font-pf-bodoni`, `--font-pf-dm-serif`, `--font-pf-plex` (Task 7's `fonts.ts`); missing variables fall back to the listed system fonts.

Design direction per theme (approved mockups; the classes below implement it):
- Premium: dark, classic serif, gold accent, centered cover, hairlines, gold solid primary CTA.
- Minimal: white, Inter, left-aligned, meta row, black primary CTA, link-style secondaries.
- Editorial: off-white paper, Fraunces, masthead, two-column body with red drop cap (wide only), numbered items.
- Fashion: black/white, Bodoni uppercase, full-width black cover block, items in a grid, uppercase square CTAs.
- Beauty: blush background, rounded white cover card, DM Serif Display, rounded item cards, pill CTAs.
- Corporate: navy bar, metadata grid, formal table (unit column hidden on narrow), total box, sober CTAs.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/components/presentation/themes/index.test.ts
import { describe, it, expect } from "vitest";
import { PROPOSAL_THEMES } from "@/lib/proposal-themes";
import { THEMES } from "./index";

describe("THEMES registry", () => {
  it("has a definition for every proposal theme, keyed by its own id", () => {
    for (const theme of PROPOSAL_THEMES) {
      expect(THEMES[theme]).toBeDefined();
      expect(THEMES[theme].id).toBe(theme);
    }
    expect(Object.keys(THEMES).sort()).toEqual([...PROPOSAL_THEMES].sort());
  });
});
```

```tsx
// src/components/presentation/presentation-renderer.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PROPOSAL_THEMES } from "@/lib/proposal-themes";
import type { PresentationModel } from "@/lib/presentation/types";
import { PresentationRenderer } from "./presentation-renderer";

const model: PresentationModel = {
  theme: "MINIMAL",
  title: "Campanha Verão",
  headline: "Verão com Bella",
  body: "Uma campanha de lançamento.\n\nSegundo parágrafo.",
  creator: { name: "Thais", handle: "@thais" },
  clientName: "Bella Cosméticos",
  items: [
    { description: "Reel patrocinado", quantity: 3, unitPriceCents: 250000, subtotalCents: 750000, unitPriceLabel: "R$ 2.500,00", subtotalLabel: "R$ 7.500,00" },
    { description: "Stories", quantity: 2, unitPriceCents: 80000, subtotalCents: 160000, unitPriceLabel: "R$ 800,00", subtotalLabel: "R$ 1.600,00" },
  ],
  totalCents: 910000,
  totalLabel: "R$ 9.100,00",
  issuedAtLabel: "25 de setembro de 2026",
};

describe.each(PROPOSAL_THEMES)("PresentationRenderer — %s", (theme) => {
  it("renders headline, body, every item and the total", () => {
    render(<PresentationRenderer model={model} theme={theme} />);

    expect(screen.getByRole("heading", { level: 1, name: "Verão com Bella" })).toBeInTheDocument();
    expect(screen.getByText("Uma campanha de lançamento.")).toBeInTheDocument();
    expect(screen.getByText("Segundo parágrafo.")).toBeInTheDocument();
    expect(screen.getByText("Reel patrocinado")).toBeInTheDocument();
    expect(screen.getByText("Stories")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Total" })).getByText("R$ 9.100,00")).toBeInTheDocument();
    expect(document.querySelector(`[data-theme="${theme}"]`)).not.toBeNull();
  });

  it("hides items and total without items, and the text section without a body", () => {
    render(<PresentationRenderer model={{ ...model, items: [], totalCents: 0, totalLabel: "R$ 0,00", body: null }} theme={theme} />);

    expect(screen.queryByText("Reel patrocinado")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Total" })).not.toBeInTheDocument();
    expect(screen.queryByText("Uma campanha de lançamento.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Adicione itens/)).not.toBeInTheDocument();
  });

  it("shows the three actions inert when no handler is given", async () => {
    render(<PresentationRenderer model={model} theme={theme} />);

    for (const label of ["Aceitar", "Pedir ajustes", "Recusar"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-disabled", "true");
    }
  });
});

describe("PresentationRenderer", () => {
  it("uses model.theme when no theme override is given", () => {
    render(<PresentationRenderer model={{ ...model, theme: "FASHION" }} />);
    expect(document.querySelector('[data-theme="FASHION"]')).not.toBeNull();
  });

  it("calls onAction with the action id when a handler is given", async () => {
    const onAction = vi.fn();
    render(<PresentationRenderer model={model} onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Pedir ajustes" }));
    expect(onAction).toHaveBeenCalledWith("request_changes");
    expect(screen.getByRole("button", { name: "Aceitar" })).not.toHaveAttribute("aria-disabled");
  });

  it("omits the client line when there is no client", () => {
    render(<PresentationRenderer model={{ ...model, clientName: null }} theme="PREMIUM" />);
    expect(screen.queryByText(/Bella Cosméticos/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/components/presentation`
Expected: FAIL — modules not found.

- [ ] **Step 3: Theme types and font stacks**

```typescript
// src/components/presentation/theme-types.ts
import type { ProposalTheme } from "@/lib/proposal-themes";

/** How the cover is composed. */
export type CoverLayout = "centered" | "split-meta" | "masthead" | "block" | "card" | "bar";
/** How the items are laid out. */
export type ItemsLayout = "lines" | "numbered" | "grid" | "cards" | "table";

export interface ThemeFonts {
  /** Headline, item names/amounts, total amount. */
  display: string;
  /** Running text. */
  text: string;
  /** Small labels, metadata, buttons. */
  ui: string;
}

/** Tailwind class strings per slot. Responsive rules use container queries (@xl:). */
export interface ThemeClasses {
  page: string;
  document: string;
  coverBox: string;
  eyebrow: string;
  headline: string;
  byline: string;
  meta: string;
  rule: string;
  body: string;
  sectionLabel: string;
  itemsBox: string;
  item: string;
  itemName: string;
  itemDetail: string;
  itemAmount: string;
  totalBox: string;
  totalLabel: string;
  totalAmount: string;
  actions: string;
  ctaPrimary: string;
  ctaSecondary: string;
}

export interface ThemeDefinition {
  id: ProposalTheme;
  cover: CoverLayout;
  items: ItemsLayout;
  fonts: ThemeFonts;
  classes: ThemeClasses;
}
```

```typescript
// src/components/presentation/font-families.ts
// CSS font-family stacks. The variables are set by next/font in
// src/components/presentation/fonts.ts (preview layout) and the root layout
// (--font-inter); the fallbacks keep tests and unstyled contexts readable.
export const FONT = {
  inter: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  cormorant: "var(--font-pf-cormorant), 'Cormorant Garamond', Georgia, serif",
  fraunces: "var(--font-pf-fraunces), Georgia, serif",
  bodoni: "var(--font-pf-bodoni), Didot, Georgia, serif",
  dmSerif: "var(--font-pf-dm-serif), Georgia, serif",
  plex: "var(--font-pf-plex), ui-sans-serif, system-ui, sans-serif",
} as const;
```

- [ ] **Step 4: The 6 theme definitions and the registry**

```typescript
// src/components/presentation/themes/premium.ts
import { FONT } from "../font-families";
import type { ThemeDefinition } from "../theme-types";

export const premiumTheme: ThemeDefinition = {
  id: "PREMIUM",
  cover: "centered",
  items: "lines",
  fonts: { display: FONT.cormorant, text: FONT.cormorant, ui: FONT.inter },
  classes: {
    page: "min-h-full bg-[#121212] text-[#EDE6DA]",
    document: "mx-auto flex w-full max-w-[880px] flex-col gap-12 px-6 py-14 @xl:px-12 @xl:py-20",
    coverBox: "",
    eyebrow: "text-[10px] uppercase tracking-[0.3em] text-[#C9A96E]",
    headline: "mt-5 text-4xl font-medium leading-[1.05] break-words @xl:text-6xl",
    byline: "mt-4 text-lg italic text-[#BDB3A2]",
    meta: "text-xs text-[#9B917F]",
    rule: "mx-auto mt-8 h-px w-12 bg-[#C9A96E]",
    body: "mx-auto max-w-[60ch] space-y-4 text-center text-lg leading-relaxed text-[#CFC6B8]",
    sectionLabel: "mb-3 text-center text-[10px] uppercase tracking-[0.3em] text-[#C9A96E]",
    itemsBox: "",
    item: "flex items-start justify-between gap-4 border-t border-[#3A342A] py-4",
    itemName: "text-xl break-words",
    itemDetail: "mt-1 text-xs text-[#9B917F]",
    itemAmount: "text-xl",
    totalBox: "flex items-baseline justify-between gap-4 border-t border-[#C9A96E] pt-4",
    totalLabel: "text-[10px] uppercase tracking-[0.3em] text-[#C9A96E]",
    totalAmount: "text-3xl text-[#C9A96E]",
    actions: "flex flex-wrap justify-center gap-3 pt-2",
    ctaPrimary: "bg-[#C9A96E] px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#121212] aria-disabled:cursor-default",
    ctaSecondary: "border border-[#6B604E] px-6 py-3 text-[11px] uppercase tracking-[0.2em] text-[#CFC6B8] aria-disabled:cursor-default",
  },
};
```

```typescript
// src/components/presentation/themes/minimal.ts
import { FONT } from "../font-families";
import type { ThemeDefinition } from "../theme-types";

export const minimalTheme: ThemeDefinition = {
  id: "MINIMAL",
  cover: "split-meta",
  items: "lines",
  fonts: { display: FONT.inter, text: FONT.inter, ui: FONT.inter },
  classes: {
    page: "min-h-full bg-white text-[#111111]",
    document: "mx-auto flex w-full max-w-[880px] flex-col gap-10 px-6 py-12 @xl:px-12 @xl:py-16",
    coverBox: "",
    eyebrow: "text-xs text-[#888888]",
    headline: "mt-10 text-3xl font-semibold leading-tight tracking-tight break-words @xl:text-5xl",
    byline: "text-sm text-[#555555]",
    meta: "text-xs text-[#888888]",
    rule: "h-px w-full bg-[#EEEEEE]",
    body: "max-w-[62ch] space-y-4 text-base leading-relaxed text-[#444444]",
    sectionLabel: "mb-2 text-xs font-medium uppercase tracking-wider text-[#888888]",
    itemsBox: "",
    item: "flex items-start justify-between gap-4 border-t border-[#EEEEEE] py-3",
    itemName: "text-sm font-medium break-words",
    itemDetail: "mt-0.5 text-xs text-[#999999]",
    itemAmount: "text-sm",
    totalBox: "flex items-baseline justify-between gap-4 border-t border-[#111111] pt-3",
    totalLabel: "text-sm font-semibold",
    totalAmount: "text-lg font-semibold",
    actions: "flex flex-wrap items-center gap-4 pt-2",
    ctaPrimary: "rounded-md bg-[#111111] px-5 py-2.5 text-sm font-medium text-white aria-disabled:cursor-default",
    ctaSecondary: "text-sm text-[#555555] underline underline-offset-4 aria-disabled:cursor-default",
  },
};
```

```typescript
// src/components/presentation/themes/editorial.ts
import { FONT } from "../font-families";
import type { ThemeDefinition } from "../theme-types";

export const editorialTheme: ThemeDefinition = {
  id: "EDITORIAL",
  cover: "masthead",
  items: "numbered",
  fonts: { display: FONT.fraunces, text: FONT.fraunces, ui: FONT.inter },
  classes: {
    page: "min-h-full bg-[#F5F1EA] text-[#1D1A16]",
    document: "mx-auto flex w-full max-w-[880px] flex-col gap-10 px-6 py-10 @xl:px-12 @xl:py-14",
    coverBox: "",
    eyebrow: "text-[10px] uppercase tracking-[0.2em]",
    headline: "mt-6 text-4xl font-semibold leading-[0.98] tracking-tight break-words @xl:text-7xl",
    byline: "mt-3 text-lg italic text-[#6B5F52]",
    meta: "text-xs text-[#6B5F52]",
    rule: "mt-2 h-0.5 w-full bg-[#1D1A16]",
    body:
      "space-y-4 text-base leading-relaxed @xl:columns-2 @xl:gap-8 " +
      "@xl:[&>p:first-child]:first-letter:float-left @xl:[&>p:first-child]:first-letter:pr-2 " +
      "@xl:[&>p:first-child]:first-letter:text-6xl @xl:[&>p:first-child]:first-letter:leading-[0.8] " +
      "@xl:[&>p:first-child]:first-letter:text-[#B3261E]",
    sectionLabel: "mb-2 text-[10px] uppercase tracking-[0.2em] text-[#B3261E]",
    itemsBox: "",
    item: "flex items-baseline justify-between gap-4 border-b border-dotted border-[#B9AD9D] py-3",
    itemName: "text-lg break-words",
    itemDetail: "mt-0.5 text-xs text-[#6B5F52]",
    itemAmount: "text-lg",
    totalBox: "flex items-baseline justify-between gap-4 pt-2",
    totalLabel: "text-[10px] uppercase tracking-[0.2em] text-[#B3261E]",
    totalAmount: "text-3xl font-semibold",
    actions: "flex flex-wrap items-center gap-4 pt-2",
    ctaPrimary: "bg-[#B3261E] px-5 py-2.5 text-sm font-medium text-white aria-disabled:cursor-default",
    ctaSecondary: "border-b border-[#1D1A16] py-1 text-sm aria-disabled:cursor-default",
  },
};
```

```typescript
// src/components/presentation/themes/fashion.ts
import { FONT } from "../font-families";
import type { ThemeDefinition } from "../theme-types";

export const fashionTheme: ThemeDefinition = {
  id: "FASHION",
  cover: "block",
  items: "grid",
  fonts: { display: FONT.bodoni, text: FONT.inter, ui: FONT.inter },
  classes: {
    page: "min-h-full bg-white text-black",
    document: "mx-auto flex w-full max-w-[880px] flex-col gap-10 pb-12 @xl:pb-16",
    coverBox: "bg-black px-6 py-12 text-white @xl:px-12 @xl:py-20",
    eyebrow: "text-[10px] uppercase tracking-[0.4em]",
    headline: "mt-6 text-5xl uppercase leading-[0.9] tracking-tight break-words @xl:text-8xl",
    byline: "mt-6 text-[10px] uppercase tracking-[0.3em]",
    meta: "text-[10px] uppercase tracking-[0.3em]",
    rule: "hidden",
    body: "space-y-4 px-6 text-base leading-relaxed @xl:px-12",
    sectionLabel: "mb-3 text-[10px] uppercase tracking-[0.4em]",
    itemsBox: "px-6 @xl:px-12",
    item: "flex flex-col justify-between gap-6 border border-black p-4",
    itemName: "text-xl uppercase break-words",
    itemDetail: "mt-1 text-[10px] uppercase tracking-[0.2em]",
    itemAmount: "text-lg",
    totalBox: "mx-6 flex items-baseline justify-between gap-4 border-t border-black pt-4 @xl:mx-12",
    totalLabel: "text-[10px] uppercase tracking-[0.4em]",
    totalAmount: "text-3xl uppercase",
    actions: "mx-6 flex flex-wrap @xl:mx-12",
    ctaPrimary: "bg-black px-6 py-3 text-[10px] uppercase tracking-[0.3em] text-white aria-disabled:cursor-default",
    ctaSecondary: "-ml-px border border-black px-6 py-3 text-[10px] uppercase tracking-[0.3em] aria-disabled:cursor-default",
  },
};
```

```typescript
// src/components/presentation/themes/beauty.ts
import { FONT } from "../font-families";
import type { ThemeDefinition } from "../theme-types";

export const beautyTheme: ThemeDefinition = {
  id: "BEAUTY",
  cover: "card",
  items: "cards",
  fonts: { display: FONT.dmSerif, text: FONT.inter, ui: FONT.inter },
  classes: {
    page: "min-h-full bg-[#FBEFEC] text-[#4A2E33]",
    document: "mx-auto flex w-full max-w-[880px] flex-col gap-8 px-5 py-10 @xl:px-10 @xl:py-14",
    coverBox:
      "flex flex-col items-center rounded-[28px] bg-white px-6 py-12 text-center shadow-[0_10px_40px_-20px_rgba(109,52,64,0.35)]",
    eyebrow: "rounded-full bg-[#F3D6D9] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#A4505E]",
    headline: "mt-5 text-4xl leading-tight text-[#6D3440] break-words @xl:text-6xl",
    byline: "mt-3 text-sm text-[#A07A80]",
    meta: "text-xs text-[#A07A80]",
    rule: "hidden",
    body: "space-y-4 px-1 text-base leading-relaxed",
    sectionLabel: "mb-3 px-1 text-xs font-medium uppercase tracking-[0.12em] text-[#A4505E]",
    itemsBox: "",
    item: "flex items-start justify-between gap-4 rounded-2xl bg-white px-5 py-4",
    itemName: "text-lg text-[#6D3440] break-words",
    itemDetail: "mt-0.5 text-xs text-[#B08990]",
    itemAmount: "text-lg text-[#6D3440]",
    totalBox: "flex items-baseline justify-between gap-4 px-5",
    totalLabel: "text-sm font-medium text-[#A4505E]",
    totalAmount: "text-3xl text-[#6D3440]",
    actions: "flex flex-wrap justify-center gap-3",
    ctaPrimary: "rounded-full bg-[#D4838F] px-6 py-3 text-sm font-semibold text-white aria-disabled:cursor-default",
    ctaSecondary: "rounded-full bg-white px-6 py-3 text-sm text-[#A4505E] aria-disabled:cursor-default",
  },
};
```

```typescript
// src/components/presentation/themes/corporate.ts
import { FONT } from "../font-families";
import type { ThemeDefinition } from "../theme-types";

export const corporateTheme: ThemeDefinition = {
  id: "CORPORATE",
  cover: "bar",
  items: "table",
  fonts: { display: FONT.plex, text: FONT.plex, ui: FONT.plex },
  classes: {
    page: "min-h-full bg-white text-[#1B2433]",
    document: "mx-auto flex w-full max-w-[880px] flex-col gap-8 pb-12",
    coverBox:
      "flex items-center justify-between gap-4 bg-[#1F3A5F] px-6 py-4 text-xs font-medium uppercase tracking-wider text-white @xl:px-10",
    eyebrow: "",
    headline: "px-6 text-2xl font-semibold leading-snug break-words @xl:px-10 @xl:text-4xl",
    byline: "",
    meta: "px-6 text-xs text-[#5B6678] @xl:px-10",
    rule: "hidden",
    body: "space-y-3 px-6 text-sm leading-relaxed text-[#3B4557] @xl:px-10",
    sectionLabel: "mb-2 text-xs font-semibold uppercase tracking-wider text-[#5B6678]",
    itemsBox: "px-6 @xl:px-10",
    item: "border-b border-[#E5E9F0] text-sm",
    itemName: "break-words",
    itemDetail: "border-b border-[#C5CEDB] bg-[#EEF2F7] text-[11px] uppercase tracking-wide text-[#5B6678]",
    itemAmount: "font-medium",
    totalBox:
      "mx-6 flex items-baseline justify-between gap-4 bg-[#EEF2F7] px-4 py-3 @xl:mr-10 @xl:ml-auto @xl:w-[45%]",
    totalLabel: "text-sm font-semibold",
    totalAmount: "text-xl font-semibold",
    actions: "flex flex-wrap gap-3 px-6 @xl:px-10",
    ctaPrimary: "rounded-sm bg-[#1F3A5F] px-5 py-2.5 text-sm font-medium text-white aria-disabled:cursor-default",
    ctaSecondary: "rounded-sm border border-[#C5CEDB] px-5 py-2.5 text-sm aria-disabled:cursor-default",
  },
};
```

```typescript
// src/components/presentation/themes/index.ts
import type { ProposalTheme } from "@/lib/proposal-themes";
import type { ThemeDefinition } from "../theme-types";
import { premiumTheme } from "./premium";
import { minimalTheme } from "./minimal";
import { editorialTheme } from "./editorial";
import { fashionTheme } from "./fashion";
import { beautyTheme } from "./beauty";
import { corporateTheme } from "./corporate";

// A Record keyed by ProposalTheme: a missing theme is a compile error.
export const THEMES: Record<ProposalTheme, ThemeDefinition> = {
  PREMIUM: premiumTheme,
  MINIMAL: minimalTheme,
  EDITORIAL: editorialTheme,
  FASHION: fashionTheme,
  BEAUTY: beautyTheme,
  CORPORATE: corporateTheme,
};
```

- [ ] **Step 5: Shared sections and the renderer**

```tsx
// src/components/presentation/sections.tsx
import * as React from "react";
import { cn } from "@/lib/utils";
import type { PresentationAction, PresentationItem, PresentationModel } from "@/lib/presentation/types";
import type { ThemeDefinition } from "./theme-types";

function creatorLine(model: PresentationModel): string {
  return [model.creator.name, model.creator.handle].filter(Boolean).join(" · ");
}

export function CoverSection({ model, theme }: { model: PresentationModel; theme: ThemeDefinition }) {
  const c = theme.classes;
  const ui = { fontFamily: theme.fonts.ui };
  const headline = (
    <h1 className={c.headline} style={{ fontFamily: theme.fonts.display }}>
      {model.headline}
    </h1>
  );

  switch (theme.cover) {
    case "centered":
      return (
        <header className="flex flex-col items-center text-center">
          <p className={c.eyebrow} style={ui}>
            {model.clientName ? `Proposta comercial · ${model.clientName}` : "Proposta comercial"}
          </p>
          {headline}
          <p className={c.byline}>por {creatorLine(model)}</p>
          <div className={c.rule} aria-hidden="true" />
        </header>
      );
    case "split-meta":
      return (
        <header>
          <div className={cn("flex flex-wrap justify-between gap-2", c.meta)} style={ui}>
            <span>{creatorLine(model)}</span>
            {model.clientName ? <span>Proposta para {model.clientName}</span> : null}
          </div>
          {headline}
          <p className={cn("mt-3", c.meta)} style={ui}>
            {model.issuedAtLabel}
          </p>
        </header>
      );
    case "masthead":
      return (
        <header>
          <div className={cn("flex flex-wrap justify-between gap-2", c.eyebrow)} style={ui}>
            <span>{model.creator.name}</span>
            <span>{model.issuedAtLabel}</span>
            {model.clientName ? <span>{model.clientName}</span> : null}
          </div>
          <div className={c.rule} aria-hidden="true" />
          {headline}
          {model.headline !== model.title ? <p className={c.byline}>{model.title}</p> : null}
        </header>
      );
    case "block":
      return (
        <header className={c.coverBox}>
          <p className={c.eyebrow} style={ui}>
            {model.clientName ? `${model.clientName} × ${model.creator.name}` : model.creator.name}
          </p>
          {headline}
          <p className={c.byline} style={ui}>
            Proposta · {model.issuedAtLabel}
          </p>
        </header>
      );
    case "card":
      return (
        <header className={c.coverBox}>
          {model.clientName ? (
            <p className={c.eyebrow} style={ui}>
              Proposta para {model.clientName}
            </p>
          ) : null}
          {headline}
          <p className={c.byline}>por {creatorLine(model)}</p>
        </header>
      );
    case "bar":
      return (
        <header className="flex flex-col gap-5">
          <div className={c.coverBox} style={ui}>
            <span>Proposta comercial</span>
            <span>{model.issuedAtLabel}</span>
          </div>
          <dl className={cn("grid grid-cols-2 gap-3 @xl:grid-cols-3", c.meta)} style={ui}>
            {model.clientName ? (
              <div>
                <dt>Cliente</dt>
                <dd className="font-semibold text-[#1B2433]">{model.clientName}</dd>
              </div>
            ) : null}
            <div>
              <dt>Creator</dt>
              <dd className="font-semibold text-[#1B2433]">{creatorLine(model)}</dd>
            </div>
            <div>
              <dt>Emitida em</dt>
              <dd className="font-semibold text-[#1B2433]">{model.issuedAtLabel}</dd>
            </div>
          </dl>
          {headline}
        </header>
      );
  }
}

export function TextSection({ body, theme }: { body: string; theme: ThemeDefinition }) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return (
    <section className={theme.classes.body}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </section>
  );
}

function ItemsTable({ items, theme }: { items: PresentationItem[]; theme: ThemeDefinition }) {
  const c = theme.classes;
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <thead style={{ fontFamily: theme.fonts.ui }}>
        <tr className={c.itemDetail}>
          <th scope="col" className="w-1/2 px-2 py-2 font-semibold">Entrega</th>
          <th scope="col" className="px-2 py-2 text-right font-semibold">Qtd</th>
          <th scope="col" className="hidden px-2 py-2 text-right font-semibold @xl:table-cell">Unitário</th>
          <th scope="col" className="px-2 py-2 text-right font-semibold">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, index) => (
          <tr key={index} className={c.item}>
            <td className={cn("px-2 py-2", c.itemName)}>
              <span>{item.description}</span>
            </td>
            <td className="px-2 py-2 text-right tabular-nums">{item.quantity}</td>
            <td className="hidden px-2 py-2 text-right tabular-nums @xl:table-cell">{item.unitPriceLabel}</td>
            <td className={cn("px-2 py-2 text-right tabular-nums", c.itemAmount)}>{item.subtotalLabel}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const LIST_LAYOUT: Record<Exclude<ThemeDefinition["items"], "table">, string> = {
  lines: "flex flex-col",
  numbered: "flex flex-col",
  grid: "grid grid-cols-1 gap-3 @xl:grid-cols-2",
  cards: "flex flex-col gap-2",
};

export function ItemsSection({ items, theme }: { items: PresentationItem[]; theme: ThemeDefinition }) {
  const c = theme.classes;
  const display = { fontFamily: theme.fonts.display };
  const ui = { fontFamily: theme.fonts.ui };

  return (
    <section className={c.itemsBox} aria-label="Entregas">
      <h2 className={c.sectionLabel} style={ui}>
        Entregas
      </h2>
      {theme.items === "table" ? (
        <ItemsTable items={items} theme={theme} />
      ) : (
        <ul className={LIST_LAYOUT[theme.items]}>
          {items.map((item, index) => (
            <li key={index} className={c.item}>
              <div className="min-w-0">
                <p className={c.itemName} style={display}>
                  {theme.items === "numbered" ? (
                    <span aria-hidden="true">{String(index + 1).padStart(2, "0")} — </span>
                  ) : null}
                  <span>{item.description}</span>
                </p>
                <p className={c.itemDetail} style={ui}>
                  {item.quantity} × {item.unitPriceLabel}
                </p>
              </div>
              <p className={cn("shrink-0 tabular-nums", c.itemAmount)} style={display}>
                {item.subtotalLabel}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TotalSection({ model, theme }: { model: PresentationModel; theme: ThemeDefinition }) {
  const c = theme.classes;
  return (
    <section className={c.totalBox} aria-label="Total">
      <p className={c.totalLabel} style={{ fontFamily: theme.fonts.ui }}>
        Total
      </p>
      <p className={cn("tabular-nums", c.totalAmount)} style={{ fontFamily: theme.fonts.display }}>
        {model.totalLabel}
      </p>
    </section>
  );
}

const ACTIONS: Array<{ id: PresentationAction; label: string }> = [
  { id: "accept", label: "Aceitar" },
  { id: "request_changes", label: "Pedir ajustes" },
  { id: "reject", label: "Recusar" },
];

export function ActionsSection({
  theme,
  onAction,
}: {
  theme: ThemeDefinition;
  onAction?: (action: PresentationAction) => void;
}) {
  return (
    <div className={theme.classes.actions} style={{ fontFamily: theme.fonts.ui }}>
      {ACTIONS.map((action, index) => (
        <button
          key={action.id}
          type="button"
          className={index === 0 ? theme.classes.ctaPrimary : theme.classes.ctaSecondary}
          aria-disabled={onAction ? undefined : true}
          onClick={onAction ? () => onAction(action.id) : undefined}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
```

```tsx
// src/components/presentation/presentation-renderer.tsx
import * as React from "react";
import { cn } from "@/lib/utils";
import type { ProposalTheme } from "@/lib/proposal-themes";
import type { PresentationAction, PresentationModel } from "@/lib/presentation/types";
import { THEMES } from "./themes";
import { ActionsSection, CoverSection, ItemsSection, TextSection, TotalSection } from "./sections";

export interface PresentationRendererProps {
  model: PresentationModel;
  /** Overrides model.theme (the preview compares themes without rebuilding the model). */
  theme?: ProposalTheme;
  /** Without a handler the action buttons are inert (preview). */
  onAction?: (action: PresentationAction) => void;
}

/**
 * Draws a proposal in a Presentation Theme. Pure presentation: no data
 * access, no next/font, usable from Client and Server Components alike.
 * Responsive rules are container queries on this root, so a 390px frame
 * renders the phone layout even on a wide screen.
 */
export function PresentationRenderer({ model, theme, onAction }: PresentationRendererProps) {
  const definition = THEMES[theme ?? model.theme];

  return (
    <div
      data-theme={definition.id}
      className={cn("@container w-full", definition.classes.page)}
      style={{ fontFamily: definition.fonts.text }}
    >
      <article className={definition.classes.document}>
        <CoverSection model={model} theme={definition} />
        {model.body ? <TextSection body={model.body} theme={definition} /> : null}
        {model.items.length > 0 ? (
          <>
            <ItemsSection items={model.items} theme={definition} />
            <TotalSection model={model} theme={definition} />
          </>
        ) : null}
        <ActionsSection theme={definition} onAction={onAction} />
      </article>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/components/presentation`
Expected: PASS (1 registry test + 18 per-theme tests + 3 renderer tests).

- [ ] **Step 7: Confirm the renderer stays server-free, run everything, commit**

```bash
grep -rn "@/db\|@/services\|@/repositories\|next/headers\|next/font\|server-only" src/components/presentation || echo "server-free"
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/components/presentation
git commit -m "feat: add presentation renderer with six themes"
```

Expected: `server-free`.

---

### Task 6: `PreviewShell` (client)

**Files:**
- Create: `src/lib/presentation/theme-param.ts`, `src/components/presentation/preview-shell.tsx`
- Test: `src/lib/presentation/theme-param.test.ts`, `src/components/presentation/preview-shell.test.tsx`

**Interfaces:**
- Consumes: `PresentationRenderer` (Task 5); `PresentationModel` (Task 2); `ProposalTheme`, `ProposalStatus`, `PROPOSAL_THEMES`, `PROPOSAL_THEME_LABELS` (Task 1); `useUpdateProposal(proposalId)` from `@/hooks/use-proposal` (mutation input `{ theme }`); `Button` from `@/components/ui/button`; `toast` from `sonner`.
- Produces: `parseThemeParam(value: string | string[] | undefined): ProposalTheme | null` (case-insensitive; arrays use the first value; invalid → null); `themeParamValue(theme: ProposalTheme): string` (lowercase, e.g. `"editorial"`).
- Produces: `PreviewShell(props: { proposalId: string; model: PresentationModel; savedTheme: ProposalTheme; status: ProposalStatus; initialTheme: ProposalTheme })` — Client Component.

Behaviour:
- Theme buttons (group "Tema"): selecting one re-renders with that theme and writes `?theme=<lowercase>` via `window.history.replaceState` (no navigation, no data reload, no API call). Selecting the saved theme removes the param. The saved theme's button reads "<Label> (atual)".
- "Aplicar este tema" shows only when the visible theme ≠ saved theme and status ≠ `ARCHIVED`; it calls `updateProposal.mutate({ theme })`; on success the visible theme becomes the saved one, the param is removed and `toast.success("Tema aplicado.")` fires. (Errors already toast inside `useUpdateProposal`.)
- Viewport group ("Tamanho da tela"): "Desktop" (default) and "Celular"; Celular wraps the renderer in a `data-testid="mobile-frame"` element with class `w-[390px]`.
- "Adicione itens para mostrar valores" appears in the toolbar when `model.items.length === 0`.
- "Voltar ao editor" links to `/proposals/${proposalId}`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/presentation/theme-param.test.ts
import { describe, it, expect } from "vitest";
import { parseThemeParam, themeParamValue } from "./theme-param";

describe("theme param", () => {
  it("parses case-insensitively and rejects unknown values", () => {
    expect(parseThemeParam("editorial")).toBe("EDITORIAL");
    expect(parseThemeParam("FASHION")).toBe("FASHION");
    expect(parseThemeParam(["beauty", "minimal"])).toBe("BEAUTY");
    expect(parseThemeParam("neon")).toBeNull();
    expect(parseThemeParam("")).toBeNull();
    expect(parseThemeParam(undefined)).toBeNull();
  });

  it("writes the lowercase value", () => {
    expect(themeParamValue("CORPORATE")).toBe("corporate");
  });
});
```

```tsx
// src/components/presentation/preview-shell.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PresentationModel } from "@/lib/presentation/types";

const mutateMock = vi.fn();
vi.mock("@/hooks/use-proposal", () => ({
  useUpdateProposal: () => ({ mutate: mutateMock, isPending: false }),
}));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() } }));

import { PreviewShell } from "./preview-shell";

const model: PresentationModel = {
  theme: "MINIMAL",
  title: "Campanha Verão",
  headline: "Verão com Bella",
  body: null,
  creator: { name: "Thais", handle: "@thais" },
  clientName: "Bella Cosméticos",
  items: [
    { description: "Reel patrocinado", quantity: 1, unitPriceCents: 250000, subtotalCents: 250000, unitPriceLabel: "R$ 2.500,00", subtotalLabel: "R$ 2.500,00" },
  ],
  totalCents: 250000,
  totalLabel: "R$ 2.500,00",
  issuedAtLabel: "25 de setembro de 2026",
};

function renderShell(overrides: Partial<React.ComponentProps<typeof PreviewShell>> = {}) {
  return render(
    <PreviewShell proposalId="p1" model={model} savedTheme="MINIMAL" status="DRAFT" initialTheme="MINIMAL" {...overrides} />,
  );
}

describe("PreviewShell", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    toastSuccess.mockReset();
    window.history.replaceState(null, "", "/proposals/p1/preview");
  });

  it("switches the rendered theme and the URL without calling the API", async () => {
    renderShell();

    await userEvent.click(screen.getByRole("button", { name: "Editorial" }));

    expect(document.querySelector('[data-theme="EDITORIAL"]')).not.toBeNull();
    expect(window.location.search).toBe("?theme=editorial");
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Editorial" })).toHaveAttribute("aria-pressed", "true");
  });

  it("marks the saved theme as current and removes the param when it is selected again", async () => {
    renderShell();

    await userEvent.click(screen.getByRole("button", { name: "Moda" }));
    await userEvent.click(screen.getByRole("button", { name: "Minimalista (atual)" }));

    expect(window.location.search).toBe("");
  });

  it("starts from the initial theme given by ?theme=", () => {
    renderShell({ initialTheme: "BEAUTY" });
    expect(document.querySelector('[data-theme="BEAUTY"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Aplicar este tema" })).toBeInTheDocument();
  });

  it("shows 'Aplicar este tema' only for a different theme on a non-archived proposal", async () => {
    renderShell();
    expect(screen.queryByRole("button", { name: "Aplicar este tema" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Premium" }));
    expect(screen.getByRole("button", { name: "Aplicar este tema" })).toBeInTheDocument();
  });

  it("never offers 'Aplicar este tema' for an archived proposal", async () => {
    renderShell({ status: "ARCHIVED" });
    await userEvent.click(screen.getByRole("button", { name: "Premium" }));
    expect(screen.queryByRole("button", { name: "Aplicar este tema" })).not.toBeInTheDocument();
  });

  it("applies the theme through the existing mutation and makes it current", async () => {
    mutateMock.mockImplementation((_input: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
    renderShell();

    await userEvent.click(screen.getByRole("button", { name: "Premium" }));
    await userEvent.click(screen.getByRole("button", { name: "Aplicar este tema" }));

    expect(mutateMock).toHaveBeenCalledWith({ theme: "PREMIUM" }, expect.anything());
    expect(toastSuccess).toHaveBeenCalledWith("Tema aplicado.");
    expect(screen.getByRole("button", { name: "Premium (atual)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aplicar este tema" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("renders the document inside a 390px frame in phone mode", async () => {
    renderShell();
    expect(screen.queryByTestId("mobile-frame")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Celular" }));

    const frame = screen.getByTestId("mobile-frame");
    expect(frame.className).toContain("w-[390px]");
    expect(frame.querySelector('[data-theme="MINIMAL"]')).not.toBeNull();
  });

  it("warns about missing items in the toolbar, never inside the document", () => {
    renderShell({ model: { ...model, items: [], totalCents: 0, totalLabel: "R$ 0,00" } });

    const warning = screen.getByText("Adicione itens para mostrar valores");
    expect(warning.closest('[data-theme]')).toBeNull();
    expect(warning.closest('[role="toolbar"]')).not.toBeNull();
  });

  it("links back to the editor", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Voltar ao editor" })).toHaveAttribute("href", "/proposals/p1");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/presentation/theme-param.test.ts src/components/presentation/preview-shell.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/presentation/theme-param.ts
import { PROPOSAL_THEMES, type ProposalTheme } from "@/lib/proposal-themes";

/** Reads `?theme=` (case-insensitive). Unknown or empty -> null. */
export function parseThemeParam(value: string | string[] | undefined): ProposalTheme | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim().toUpperCase();
  if (!raw) return null;
  return (PROPOSAL_THEMES as string[]).includes(raw) ? (raw as ProposalTheme) : null;
}

export function themeParamValue(theme: ProposalTheme): string {
  return theme.toLowerCase();
}
```

```tsx
// src/components/presentation/preview-shell.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUpdateProposal } from "@/hooks/use-proposal";
import {
  PROPOSAL_THEMES,
  PROPOSAL_THEME_LABELS,
  type ProposalStatus,
  type ProposalTheme,
} from "@/lib/proposal-themes";
import type { PresentationModel } from "@/lib/presentation/types";
import { themeParamValue } from "@/lib/presentation/theme-param";
import { PresentationRenderer } from "./presentation-renderer";

export interface PreviewShellProps {
  proposalId: string;
  model: PresentationModel;
  savedTheme: ProposalTheme;
  status: ProposalStatus;
  initialTheme: ProposalTheme;
}

type Viewport = "desktop" | "mobile";

// Native history API: updates ?theme= without a navigation, so the Server
// Component doesn't refetch the proposal (Next integrates replaceState with
// its router).
function writeThemeParam(theme: ProposalTheme | null) {
  const url = new URL(window.location.href);
  if (theme) {
    url.searchParams.set("theme", themeParamValue(theme));
  } else {
    url.searchParams.delete("theme");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function PreviewShell({ proposalId, model, savedTheme: initialSavedTheme, status, initialTheme }: PreviewShellProps) {
  const [theme, setTheme] = React.useState<ProposalTheme>(initialTheme);
  const [savedTheme, setSavedTheme] = React.useState<ProposalTheme>(initialSavedTheme);
  const [viewport, setViewport] = React.useState<Viewport>("desktop");
  const updateProposal = useUpdateProposal(proposalId);

  const canApply = theme !== savedTheme && status !== "ARCHIVED";

  function selectTheme(next: ProposalTheme) {
    setTheme(next);
    writeThemeParam(next === savedTheme ? null : next);
  }

  function applyTheme() {
    const applied = theme;
    updateProposal.mutate(
      { theme: applied },
      {
        onSuccess: () => {
          setSavedTheme(applied);
          writeThemeParam(null);
          toast.success("Tema aplicado.");
        },
      },
    );
  }

  const renderer = <PresentationRenderer model={model} theme={theme} />;

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <div
        role="toolbar"
        aria-label="Pré-visualização"
        className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3"
      >
        <Link
          href={`/proposals/${proposalId}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Voltar ao editor
        </Link>

        <div role="group" aria-label="Tema" className="flex flex-wrap gap-1">
          {PROPOSAL_THEMES.map((item) => (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={item === theme ? "default" : "outline"}
              aria-pressed={item === theme}
              onClick={() => selectTheme(item)}
            >
              {PROPOSAL_THEME_LABELS[item]}
              {item === savedTheme ? " (atual)" : null}
            </Button>
          ))}
        </div>

        {canApply ? (
          <Button type="button" size="sm" onClick={applyTheme} disabled={updateProposal.isPending}>
            Aplicar este tema
          </Button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {model.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">Adicione itens para mostrar valores</p>
          ) : null}
          <div role="group" aria-label="Tamanho da tela" className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={viewport === "desktop" ? "default" : "outline"}
              aria-pressed={viewport === "desktop"}
              onClick={() => setViewport("desktop")}
            >
              <Monitor className="size-4" aria-hidden="true" />
              Desktop
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewport === "mobile" ? "default" : "outline"}
              aria-pressed={viewport === "mobile"}
              onClick={() => setViewport("mobile")}
            >
              <Smartphone className="size-4" aria-hidden="true" />
              Celular
            </Button>
          </div>
        </div>
      </div>

      <div className={cn("flex-1", viewport === "mobile" && "flex justify-center px-4 py-6")}>
        {viewport === "mobile" ? (
          <div
            data-testid="mobile-frame"
            className="w-[390px] max-w-full overflow-hidden rounded-[32px] border-8 border-foreground/80 shadow-xl"
          >
            {renderer}
          </div>
        ) : (
          renderer
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/presentation/theme-param.test.ts src/components/presentation/preview-shell.test.tsx`
Expected: PASS (2 + 9 tests). If the "(atual)" accessible name doesn't match because of whitespace, keep the visible text "Minimalista (atual)" and adjust only the markup, not the test's expected name.

- [ ] **Step 5: Full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/lib/presentation src/components/presentation
git commit -m "feat: add proposal preview shell with theme comparison"
```

---

### Task 7: Preview route, fonts and the builder button

**Files:**
- Create: `src/components/presentation/fonts.ts`, `src/app/(preview)/layout.tsx`, `src/app/(preview)/proposals/[id]/preview/page.tsx`
- Modify: `src/app/(app)/proposals/[id]/page.tsx` (add "Pré-visualizar")
- Test: `src/app/(app)/proposals/[id]/page.test.tsx` (new)

**Interfaces:**
- Consumes: `requireAppSession()` (Task 3); `ProposalPresentationService.loadPreviewSource` (Task 4); `buildPresentation` (Task 2); `parseThemeParam` (Task 6); `PreviewShell` (Task 6); `db` from `@/db`.
- Produces: route `/proposals/[id]/preview` (URL unchanged by the `(preview)` group); CSS variables `--font-pf-cormorant`, `--font-pf-fraunces`, `--font-pf-bodoni`, `--font-pf-dm-serif`, `--font-pf-plex` on the preview subtree.

- [ ] **Step 1: Write the failing builder test**

```tsx
// src/app/(app)/proposals/[id]/page.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateMock = vi.fn();
vi.mock("@/hooks/use-proposal", () => ({
  useProposal: () => ({
    data: { id: "p1", organizationId: "o1", opportunityId: "op1", title: "Campanha", theme: "MINIMAL", status: "DRAFT", createdAt: "" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateProposal: () => ({ mutate: mutateMock, isPending: false }),
}));
vi.mock("@/hooks/use-opportunity", () => ({ useOpportunity: () => ({ data: { creatorId: "c1" } }) }));
vi.mock("@/hooks/use-proposal-blocks", () => ({
  useProposalBlocks: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-proposal-items", () => ({
  useProposalItems: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/components/proposals/proposal-items-table", () => ({ ProposalItemsTable: () => null }));
vi.mock("@/components/proposals/proposal-cover-section", () => ({ ProposalCoverSection: () => null }));
vi.mock("@/components/proposals/proposal-text-section", () => ({ ProposalTextSection: () => null }));

import ProposalPage from "./page";

describe("ProposalPage (builder)", () => {
  it("links to the preview", async () => {
    render(<ProposalPage params={Promise.resolve({ id: "p1" })} />);
    expect(await screen.findByRole("link", { name: "Pré-visualizar" })).toHaveAttribute("href", "/proposals/p1/preview");
  });

  it("saves the theme through the Tema select", async () => {
    render(<ProposalPage params={Promise.resolve({ id: "p1" })} />);
    await userEvent.click(await screen.findByRole("combobox", { name: "Tema" }));
    await userEvent.click(screen.getByRole("option", { name: "Editorial" }));
    expect(mutateMock).toHaveBeenCalledWith({ theme: "EDITORIAL" });
  });
});
```

(`React.use(params)` suspends on first render; `findBy…` waits for it. If the page needs a `Suspense` wrapper in tests, wrap the render in `<React.Suspense fallback={null}>` — do not change the page for the test.)

- [ ] **Step 2: Run it to see it fail**

Run: `/opt/homebrew/bin/pnpm vitest run "src/app/(app)/proposals/[id]/page.test.tsx"`
Expected: FAIL — no "Pré-visualizar" link (the select test may already pass after Task 1).

- [ ] **Step 3: Add the builder button**

In `src/app/(app)/proposals/[id]/page.tsx`, turn the theme field into a row with the preview link (add `Eye` to the `lucide-react` import):

```tsx
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="proposal-theme">
            Tema
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={proposal.theme} onValueChange={handleThemeChange} disabled={readOnly}>
              <SelectTrigger id="proposal-theme" aria-label="Tema" className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPOSAL_THEMES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {PROPOSAL_THEME_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild variant="outline" size="sm">
              <Link href={`/proposals/${proposalId}/preview`}>
                <Eye className="size-4" aria-hidden="true" />
                Pré-visualizar
              </Link>
            </Button>
          </div>
        </div>
```

- [ ] **Step 4: Run it to see it pass**

Run: `/opt/homebrew/bin/pnpm vitest run "src/app/(app)/proposals/[id]/page.test.tsx"`
Expected: PASS (2 tests).

- [ ] **Step 5: Fonts, preview layout and page**

Read `node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md` first. All five families below are variable fonts except DM Serif Display (single weight 400), per `node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`.

```typescript
// src/components/presentation/fonts.ts
// next/font loaders for the Presentation Themes. Imported only by
// src/app/(preview)/layout.tsx (and later the public proposal page) --
// never by the renderer, so the renderer stays testable outside Next.
import { Bodoni_Moda, Cormorant_Garamond, DM_Serif_Display, Fraunces, IBM_Plex_Sans } from "next/font/google";

const cormorant = Cormorant_Garamond({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-pf-cormorant" });
const fraunces = Fraunces({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-pf-fraunces" });
const bodoni = Bodoni_Moda({ subsets: ["latin"], variable: "--font-pf-bodoni" });
const dmSerif = DM_Serif_Display({ subsets: ["latin"], weight: "400", variable: "--font-pf-dm-serif" });
const plex = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-pf-plex" });

export const presentationFontVariables = [
  cormorant.variable,
  fraunces.variable,
  bodoni.variable,
  dmSerif.variable,
  plex.variable,
].join(" ");
```

```tsx
// src/app/(preview)/layout.tsx
import { requireAppSession } from "@/lib/auth/require-app-session";
import { presentationFontVariables } from "@/components/presentation/fonts";

// Reads the session cookie on every request.
export const dynamic = "force-dynamic";

// Full-screen surfaces without the app shell (sidebar/header), protected
// exactly like (app): src/proxy.ts sends visitors without a Supabase user to
// /login; requireAppSession() handles authenticated users without access.
export default async function PreviewLayout({ children }: { children: React.ReactNode }) {
  await requireAppSession();
  return <div className={presentationFontVariables}>{children}</div>;
}
```

```tsx
// src/app/(preview)/proposals/[id]/preview/page.tsx
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireAppSession } from "@/lib/auth/require-app-session";
import { ProposalPresentationService } from "@/services/proposal-presentation.service";
import { buildPresentation } from "@/lib/presentation/build-presentation";
import { parseThemeParam } from "@/lib/presentation/theme-param";
import { PreviewShell } from "@/components/presentation/preview-shell";

export default async function ProposalPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ theme?: string | string[] }>;
}) {
  const session = await requireAppSession();
  const { id } = await params;
  const { theme } = await searchParams;

  const source = await ProposalPresentationService.loadPreviewSource(db, session.organizationId, id);
  if (!source) notFound();

  // "now" is decided here, on the server, so buildPresentation stays pure.
  const model = buildPresentation(source.snapshot, {
    creator: source.creator,
    client: { name: source.clientName },
    issuedAt: new Date(),
  });

  return (
    <PreviewShell
      proposalId={id}
      model={model}
      savedTheme={model.theme}
      status={source.status}
      initialTheme={parseThemeParam(theme) ?? model.theme}
    />
  );
}
```

(If the build complains that `(app)/proposals/[id]` and `(preview)/proposals/[id]/preview` conflict, stop and report NEEDS_CONTEXT with the error — the two resolve to different URLs and should be valid per `route-groups.md`.)

- [ ] **Step 6: Full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/components/presentation/fonts.ts "src/app/(preview)" "src/app/(app)/proposals/[id]/page.tsx" "src/app/(app)/proposals/[id]/page.test.tsx"
git commit -m "feat: add proposal preview route and builder preview button"
```

Expected build output lists `ƒ /proposals/[id]/preview`.

---

## Visual verification (controller, after Task 7, before the final review)

Run by the controller in the browser pane against the dev server (dev DB seeded, logged in):
1. Open `/proposals/<demo id>/preview` and capture each of the 6 themes at desktop width (~1280px) and in "Celular" mode (390px frame).
2. Stress content: a proposal with a long headline (~90 chars), 8 items with long descriptions and a total ≥ R$ 100.000,00.
3. Criteria per capture: no horizontal scroll at 375–390px; text legible (contrast); total visible; nothing cut off; no builder message inside the document; "Aplicar este tema" persists (reload shows the new theme as "(atual)"); `/proposals/<id of another org or random uuid>/preview` → 404.
4. Findings go to the final review as input.

## Self-Review

**Spec coverage:**
- #1 rename + manual migration → Task 1 (custom migration + snapshot patch, verified procedure).
- #2 legacy snapshots → Task 2 (`theme ?? template` test).
- #3/#4 pipeline + pure `buildPresentation`, `issuedAt` from context, fixed TZ → Task 2; "now" set in the page → Task 7.
- #5 brand > company > null → Task 4.
- #6 renderer + shared sections + typed registry → Task 5.
- #7 server-free renderer → Task 5 (grep step) + Global Constraints.
- #8 next/font, all 6 available in preview → Task 7 `fonts.ts` + `(preview)` layout.
- #9 inert actions + `onAction` slot for Spec 2 → Task 5.
- #10 incomplete content, no in-document warnings → Tasks 5 and 6.
- #11 375px → desktop via container queries → Task 5 + visual verification.
- #12 `(preview)` group protected like `(app)` via shared `requireAppSession` → Tasks 3 and 7.
- #13 server loader by id + session org, `notFound()` → Tasks 4 and 7.
- #14–#19 PreviewShell (toolbar, `?theme=` without persistence, apply via `useUpdateProposal`, 390px, archived) → Task 6.
- #20 builder "Tema" + "Pré-visualizar" → Tasks 1 and 7.
- §5 tests → each task; visual verification → controller section.

**Placeholder scan:** every code step has complete code; adaptation notes only cover names that must be read from existing files.

**Type consistency:** `ProposalTheme`/`PROPOSAL_THEMES`/`PROPOSAL_THEME_LABELS` (Task 1) used in Tasks 2, 5, 6; `PresentationModel`/`PresentationContext`/`PresentationSnapshotInput`/`PresentationAction` (Task 2) used in 4 (via `ProposalSnapshot` assignability), 5, 6, 7; `THEMES`/`ThemeDefinition` (5); `PresentationRenderer({ model, theme?, onAction? })` (5) used in 6; `parseThemeParam`/`themeParamValue` (6) used in 6 and 7; `requireAppSession` (3) used in 7; `ProposalPresentationService.loadPreviewSource` → `PreviewSource` (4) used in 7.
