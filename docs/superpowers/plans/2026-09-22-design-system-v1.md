# PublyFlow Design System v1 (Foundation + Application Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PublyFlow Design System v1 — design tokens, Tailwind v4 theme integration,
core shadcn/ui primitives, and the responsive application shell (Sidebar, Header, Creator
Switcher, Command Palette) — so future screen specs (Inbox, Pipeline, Proposal Builder) have a
consistent foundation to build on.

**Architecture:** shadcn/ui-style components (copied into the repo under `src/components/ui/`,
built on Radix Primitives + Tailwind, not an installed package) for low-level primitives;
`src/components/shell/` for the application-shell-specific components that compose them. All
visual tokens live as CSS variables in `src/app/globals.css`, consumed by Tailwind v4's
`@theme inline` directive so utility classes like `bg-primary` work directly. No screen UX
(Inbox/Pipeline/Proposal Builder/Dashboard/Opportunity Detail) is implemented — only the shell
they'll render inside of.

**Tech Stack:** Next.js 16 (App Router, Server Components), React 19, Tailwind v4, Radix
Primitives, `class-variance-authority`, `clsx`/`tailwind-merge`, Lucide icons, `cmdk`, Vitest +
`@testing-library/react` for component tests.

## Global Constraints

- **Design tokens** (exact values, from the approved spec §3 — "Electric Editorial" palette):
  `--background: #F4F4F6`, `--card: #FFFFFF`, `--foreground: #08090A`,
  `--muted-foreground: #71717A`, `--border: #E4E4E7`, `--primary: #6E56CF`,
  `--primary-foreground: #FFFFFF`, `--accent: #E93D82`, `--accent-foreground: #FFFFFF`,
  `--success: #30A46C`, `--warning: #F5A623`, `--error: #E5484D`, `--info: #0091FF`.
  Two additional structural tokens are needed for hover/focus states that the spec's palette
  doesn't explicitly name but every component in this plan needs: `--muted: #EDEDF0` (hover/
  selected-row backgrounds) and `--ring: #6E56CF` (focus ring color, same as `--primary`).
- **`--card` is the only surface token** — do not introduce a separate `--surface` token (per
  spec review adjustment).
- **Radius**: `--radius-sm: 6px`, `--radius-md: 8px`, `--radius-lg: 12px`.
- **Spacing**: multiples of 4px — use Tailwind's default spacing scale (already 4px-based),
  no custom spacing scale needed.
- **Typography**: Inter (replaces the current Geist Sans/Mono boilerplate), weights
  400/500/600/700. 13px is the default for dense operational UI (tables, lists), not a
  universal rule — reading text and form inputs use 14–16px. Never go below 12px for
  functional text.
- **Icons**: Lucide (`lucide-react`) exclusively.
- **Light mode only** — no dark mode implementation. Token names are semantic/neutral so a
  future dark mode can redefine values without touching component code.
- **Responsive categories** (design convention only, not a rigid implementation rule):
  mobile `<768px`, tablet `768–1023px`, desktop `≥1024px`. Implementation uses standard
  Tailwind breakpoints (`sm` 640, `md` 768, `lg` 1024, `xl` 1280) directly.
- **Touch targets**: minimum 44×44px for any tappable target on mobile/tablet, regardless of
  the element's visual size.
- **Focus accessibility**: every interactive component must have a clearly visible
  `:focus-visible` state with adequate contrast, and preserve keyboard navigation. This is a
  global CSS rule (Task 1) plus relying on Radix's built-in focus/keyboard handling in every
  primitive — not a new E2E test suite.
- **Drawer vs. Modal**: Drawer/Sheet is the default for operational flows; Modal (Dialog) is
  reserved for confirmations and destructive actions, not long flows.
- **Creator scoping**: Inbox, Leads, Pipeline/Opportunities, Services, Rate Cards are
  creator-scoped (filtered by the selected creator). Companies and Contacts are always
  organization-wide (not filtered by the switcher). This plan only builds the switcher
  mechanism — no screen consumes it yet.
- **`organizationId` source (transitional)**: no auth/session exists yet. A single helper,
  `getDevOrganizationId()` (Task 8), reads `NEXT_PUBLIC_DEV_ORGANIZATION_ID` from the
  environment. No component or API call may read `process.env.NEXT_PUBLIC_DEV_ORGANIZATION_ID`
  directly. No hardcoded fallback — an unset variable throws explicitly. This is a
  development-only mechanism, not a security boundary (isolation is enforced by the
  backend/RLS); it will be replaced by session-derived organization resolution once
  authentication exists.
- **Out of scope for this plan** (do not implement): Kanban Board, advanced DataTable
  (TanStack Table wiring), Rich Block Editor, `dnd-kit` (no drag-and-drop infrastructure until
  the Pipeline UX is specified), any screen-specific UX (Inbox, Pipeline, Proposal Builder,
  Dashboard, Opportunity Detail), dark mode, "todos os creators" in the switcher (no
  aggregate backend endpoint exists).

---

### Task 1: Design tokens, Tailwind theme, and Inter font

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Test: `src/app/globals.css.test.ts`

**Interfaces:**
- Produces: CSS custom properties (`--background`, `--card`, `--foreground`,
  `--muted-foreground`, `--muted`, `--border`, `--ring`, `--primary`, `--primary-foreground`,
  `--accent`, `--accent-foreground`, `--success`, `--warning`, `--error`, `--info`,
  `--radius-sm`, `--radius-md`, `--radius-lg`) and their Tailwind v4 `@theme inline` mappings
  (`--color-*`), consumed by every component in every later task via utility classes like
  `bg-primary`, `text-muted-foreground`, `rounded-md`, `border-border`.
- Produces: `--font-inter` CSS variable wired to `next/font/google`'s `Inter`, replacing the
  current `--font-geist-sans`/`--font-geist-mono`.

- [ ] **Step 1: Write the failing token-presence test**

```typescript
// src/app/globals.css.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("design tokens", () => {
  it("defines the Electric Editorial palette and radii as CSS variables", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf-8");

    expect(css).toContain("--background: #F4F4F6");
    expect(css).toContain("--card: #FFFFFF");
    expect(css).toContain("--foreground: #08090A");
    expect(css).toContain("--muted-foreground: #71717A");
    expect(css).toContain("--muted: #EDEDF0");
    expect(css).toContain("--border: #E4E4E7");
    expect(css).toContain("--ring: #6E56CF");
    expect(css).toContain("--primary: #6E56CF");
    expect(css).toContain("--primary-foreground: #FFFFFF");
    expect(css).toContain("--accent: #E93D82");
    expect(css).toContain("--accent-foreground: #FFFFFF");
    expect(css).toContain("--success: #30A46C");
    expect(css).toContain("--warning: #F5A623");
    expect(css).toContain("--error: #E5484D");
    expect(css).toContain("--info: #0091FF");
    expect(css).toContain("--radius-sm: 6px");
    expect(css).toContain("--radius-md: 8px");
    expect(css).toContain("--radius-lg: 12px");
    expect(css).toContain("--font-inter");
    expect(css).not.toContain("--surface");
  });

  it("defines a visible focus-visible outline using the ring token", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf-8");
    expect(css).toContain(":focus-visible");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/globals.css.test.ts`
Expected: FAIL — `globals.css` still has the create-next-app boilerplate tokens.

- [ ] **Step 3: Rewrite `globals.css`**

```css
/* src/app/globals.css */
@import "tailwindcss";

:root {
  --background: #F4F4F6;
  --foreground: #08090A;

  --card: #FFFFFF;
  --muted: #EDEDF0;
  --muted-foreground: #71717A;

  --border: #E4E4E7;
  --ring: #6E56CF;

  --primary: #6E56CF;
  --primary-foreground: #FFFFFF;

  --accent: #E93D82;
  --accent-foreground: #FFFFFF;

  --success: #30A46C;
  --warning: #F5A623;
  --error: #E5484D;
  --info: #0091FF;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);

  --color-card: var(--card);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);

  --color-border: var(--border);
  --color-ring: var(--ring);

  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);

  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);

  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-error: var(--error);
  --color-info: var(--info);

  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);

  --font-sans: var(--font-inter);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif;
}

/* Global focus-accessibility rule (Design System spec §6): every interactive
   component must have a clearly visible focus state. Radix primitives handle
   keyboard/focus trapping internally; this rule only makes the visual
   indicator consistent across all of them. */
*:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
```

This removes the `@media (prefers-color-scheme: dark)` block entirely — dark mode is out of
scope for this plan (Global Constraints).

- [ ] **Step 4: Replace Geist with Inter in the root layout**

```typescript
// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Create Next App",
  description: "Generated by create next app",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

The `metadata` fields and the shell composition (`SidebarDesktop`/`Header`/`CreatorProvider`)
are deliberately left untouched here — Task 12 rewrites this file's body once the shell
components exist. This step's only job is the font swap.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/app/globals.css.test.ts`
Expected: PASS

- [ ] **Step 6: Verify the app builds**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
```

Expected: builds successfully (the existing `page.tsx` boilerplate still renders; it isn't
touched until Task 12).

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css src/app/globals.css.test.ts src/app/layout.tsx
git commit -m "feat: add Electric Editorial design tokens and switch to Inter"
```

---

### Task 2: Component testing infrastructure + `cn()` utility + Button + Badge

**Files:**
- Modify: `package.json` (dependencies + devDependencies)
- Modify: `vitest.config.ts`
- Modify: `vitest.setup.ts`
- Create: `src/lib/utils.ts`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/badge.tsx`
- Test: `src/lib/utils.test.ts`
- Test: `src/components/ui/button.test.tsx`
- Test: `src/components/ui/badge.test.tsx`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` from `src/lib/utils.ts` — used by every
  component in every later task to merge Tailwind classes.
- Produces: `Button` (`src/components/ui/button.tsx`) with `variant` (`default`|`secondary`|
  `outline`|`ghost`|`destructive`), `size` (`default`|`sm`|`lg`|`icon`), and `asChild` props.
- Produces: `Badge` (`src/components/ui/badge.tsx`) with `variant` (`default`|`primary`|
  `accent`|`success`|`warning`|`error`|`info`).
- Produces: jsdom test environment available per-file via `// @vitest-environment jsdom`
  docblock, `@testing-library/react`/`@testing-library/jest-dom`/`@testing-library/user-event`
  available in every later component test.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add clsx tailwind-merge class-variance-authority lucide-react @radix-ui/react-slot
pnpm add -D jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitejs/plugin-react
```

- [ ] **Step 2: Wire the React plugin and jsdom polyfills into the test setup**

Read the current content of `vitest.config.ts` and `vitest.setup.ts` first — both already
exist for the backend test suite; this step adds to them, it doesn't replace them.

```typescript
// vitest.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // All db tests share one real Postgres instance and clean up via
    // truncate (see src/test/helpers/db.ts). Vitest's default file
    // parallelism runs test files concurrently in separate workers, which
    // races those truncates against other files' inserts/selects against
    // the same tables -- e.g. one file's afterEach truncating `creators`
    // while src/db/rls-core.test.ts is mid-assertion. Running files
    // sequentially trades a bit of speed (the suite is still small) for
    // not having flaky, order-dependent DB test failures.
    fileParallelism: false,
  },
});
```

The default `environment: "node"` stays — component tests opt into `jsdom` per-file via a
`// @vitest-environment jsdom` docblock (Step 4 below), so this change doesn't affect any
existing backend test.

```typescript
// append to vitest.setup.ts
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
```

- [ ] **Step 3: Implement `cn()`**

```typescript
// src/lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

```typescript
// src/lib/utils.test.ts
import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts (last one wins)", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("drops falsy values", () => {
    expect(cn("text-sm", false && "hidden", undefined, "font-medium")).toBe(
      "text-sm font-medium",
    );
  });
});
```

Run: `pnpm vitest run src/lib/utils.test.ts` — Expected: PASS (no red/green cycle needed here,
`cn` is a two-line wrapper around two well-known libraries; the test documents its contract).

- [ ] **Step 4: Write the failing Button test**

```typescript
// src/components/ui/button.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";

describe("Button", () => {
  it("renders its label and applies the primary variant by default", () => {
    render(<Button>Nova Proposta</Button>);
    const button = screen.getByRole("button", { name: "Nova Proposta" });
    expect(button).toBeInTheDocument();
    expect(button.className).toContain("bg-primary");
  });

  it("renders as the wrapped element when asChild is used", () => {
    render(
      <Button asChild>
        <a href="/inbox">Ir para Inbox</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Ir para Inbox" });
    expect(link).toBeInTheDocument();
    expect(link.className).toContain("bg-primary");
  });

  it("respects the disabled attribute", () => {
    render(<Button disabled>Indisponível</Button>);
    expect(screen.getByRole("button", { name: "Indisponível" })).toBeDisabled();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/button.test.tsx`
Expected: FAIL — `./button` doesn't exist.

- [ ] **Step 6: Implement Button**

```typescript
// src/components/ui/button.tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-muted text-foreground hover:bg-muted/80",
        outline: "border border-border bg-card text-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        destructive: "bg-error text-white hover:bg-error/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-sm px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/button.test.tsx`
Expected: PASS

- [ ] **Step 8: Write the failing Badge test**

```typescript
// src/components/ui/badge.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders its label with the requested semantic variant", () => {
    render(<Badge variant="success">Ativo</Badge>);
    const badge = screen.getByText("Ativo");
    expect(badge.className).toContain("text-success");
  });

  it("defaults to the neutral variant", () => {
    render(<Badge>Rascunho</Badge>);
    const badge = screen.getByText("Rascunho");
    expect(badge.className).toContain("bg-muted");
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/badge.test.tsx`
Expected: FAIL — `./badge` doesn't exist.

- [ ] **Step 10: Implement Badge**

```typescript
// src/components/ui/badge.tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-muted text-foreground",
        primary: "bg-primary/10 text-primary",
        accent: "bg-accent/10 text-accent",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        error: "bg-error/10 text-error",
        info: "bg-info/10 text-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
```

- [ ] **Step 11: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/badge.test.tsx`
Expected: PASS

- [ ] **Step 12: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add package.json pnpm-lock.yaml vitest.config.ts vitest.setup.ts src/lib/utils.ts src/lib/utils.test.ts src/components/ui/button.tsx src/components/ui/button.test.tsx src/components/ui/badge.tsx src/components/ui/badge.test.tsx
git commit -m "feat: add component testing infrastructure, cn(), Button, and Badge"
```

---

### Task 3: Input + Card primitives

**Files:**
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/card.tsx`
- Test: `src/components/ui/input.test.tsx`
- Test: `src/components/ui/card.test.tsx`

**Interfaces:**
- Consumes: `cn` from `src/lib/utils.ts` (Task 2).
- Produces: `Input` (`src/components/ui/input.tsx`) — standard `<input>` props forwarded.
- Produces: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`
  from `src/components/ui/card.tsx`.

- [ ] **Step 1: Write the failing Input test**

```typescript
// src/components/ui/input.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./input";

describe("Input", () => {
  it("accepts typed text and forwards standard input props", async () => {
    const user = userEvent.setup();
    render(<Input placeholder="Buscar..." />);
    const input = screen.getByPlaceholderText("Buscar...");
    await user.type(input, "Bella Cosméticos");
    expect(input).toHaveValue("Bella Cosméticos");
  });

  it("respects the disabled attribute", () => {
    render(<Input disabled placeholder="Indisponível" />);
    expect(screen.getByPlaceholderText("Indisponível")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/input.test.tsx`
Expected: FAIL — `./input` doesn't exist.

- [ ] **Step 3: Implement Input**

```typescript
// src/components/ui/input.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/input.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing Card test**

```typescript
// src/components/ui/card.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";

describe("Card", () => {
  it("renders its composed sections", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Bella Cosméticos</CardTitle>
          <CardDescription>Opportunity em Negociação</CardDescription>
        </CardHeader>
        <CardContent>R$ 5.000</CardContent>
        <CardFooter>Ver detalhes</CardFooter>
      </Card>,
    );

    expect(screen.getByText("Bella Cosméticos")).toBeInTheDocument();
    expect(screen.getByText("Opportunity em Negociação")).toBeInTheDocument();
    expect(screen.getByText("R$ 5.000")).toBeInTheDocument();
    expect(screen.getByText("Ver detalhes")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/card.test.tsx`
Expected: FAIL — `./card` doesn't exist.

- [ ] **Step 7: Implement Card**

```typescript
// src/components/ui/card.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-card text-foreground", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-4", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold leading-none", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-4 pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/card.test.tsx`
Expected: PASS

- [ ] **Step 9: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/ui/input.tsx src/components/ui/input.test.tsx src/components/ui/card.tsx src/components/ui/card.test.tsx
git commit -m "feat: add Input and Card primitives"
```

---

### Task 4: Dialog + Sheet primitives

**Files:**
- Create: `src/components/ui/dialog.tsx`
- Create: `src/components/ui/sheet.tsx`
- Test: `src/components/ui/dialog.test.tsx`
- Test: `src/components/ui/sheet.test.tsx`

**Interfaces:**
- Consumes: `cn` (Task 2).
- Produces: `Dialog`, `DialogTrigger`, `DialogClose`, `DialogPortal`, `DialogOverlay`,
  `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription` from
  `src/components/ui/dialog.tsx` — used by Task 11 (Command Palette) and reserved for future
  confirmation/destructive-action flows.
- Produces: `Sheet`, `SheetTrigger`, `SheetClose`, `SheetPortal`, `SheetOverlay`,
  `SheetContent` (with a `side: "left" | "right" | "bottom"` prop), `SheetHeader`,
  `SheetTitle`, `SheetDescription` from `src/components/ui/sheet.tsx` — used by Task 9
  (mobile Sidebar Drawer).

**Note on accessibility (per spec review correction):** both components are built directly on
`@radix-ui/react-dialog`, which owns focus trapping, return-focus-on-close, Escape-to-close,
and `aria-modal`/`role=dialog` wiring — this task does not need to (and must not) reimplement
any of that. What this task DOES need to get right is not accidentally breaking it: never
remove `DialogPrimitive.Content`'s default behavior, and keep the visually-hidden
`DialogTitle`/`SheetTitle` requirement in mind for every future usage (Radix warns at runtime
if a `Content` has no accessible title — every consumer of `SheetContent`/`DialogContent` in
later tasks must render a `Title`, using `sr-only` styling when no visible title is wanted).

- [ ] **Step 1: Install Radix Dialog**

```bash
pnpm add @radix-ui/react-dialog
```

- [ ] **Step 2: Write the failing Dialog test**

```typescript
// src/components/ui/dialog.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./dialog";

describe("Dialog", () => {
  it("opens on trigger click, shows its title/description, and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Excluir proposta</DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirmar exclusão</DialogTitle>
          <DialogDescription>Esta ação não pode ser desfeita.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByText("Confirmar exclusão")).not.toBeInTheDocument();

    await user.click(screen.getByText("Excluir proposta"));
    expect(await screen.findByText("Confirmar exclusão")).toBeInTheDocument();
    expect(screen.getByText("Esta ação não pode ser desfeita.")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Confirmar exclusão")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/dialog.test.tsx`
Expected: FAIL — `./dialog` doesn't exist.

- [ ] **Step 4: Implement Dialog**

```typescript
// src/components/ui/dialog.tsx
"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn("fixed inset-0 z-50 bg-black/40", className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-lg focus-visible:outline-none",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/dialog.test.tsx`
Expected: PASS

- [ ] **Step 6: Write the failing Sheet test**

```typescript
// src/components/ui/sheet.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./sheet";

describe("Sheet", () => {
  it("opens from the requested side and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Abrir menu</SheetTrigger>
        <SheetContent side="left">
          <SheetTitle>Navegação</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.queryByText("Navegação")).not.toBeInTheDocument();

    await user.click(screen.getByText("Abrir menu"));
    const content = await screen.findByText("Navegação");
    expect(content).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Navegação")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/sheet.test.tsx`
Expected: FAIL — `./sheet` doesn't exist.

- [ ] **Step 8: Implement Sheet**

```typescript
// src/components/ui/sheet.tsx
"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn("fixed inset-0 z-50 bg-black/40", className)}
      {...props}
    />
  );
}

const sheetVariants = cva(
  "fixed z-50 flex flex-col gap-4 bg-card p-6 shadow-lg focus-visible:outline-none",
  {
    variants: {
      side: {
        left: "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r border-border",
        right: "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l border-border",
        bottom: "inset-x-0 bottom-0 max-h-[85vh] rounded-t-lg border-t border-border",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

export interface SheetContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

function SheetContent({ className, side, children, ...props }: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
};
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/sheet.test.tsx`
Expected: PASS

- [ ] **Step 10: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add package.json pnpm-lock.yaml src/components/ui/dialog.tsx src/components/ui/dialog.test.tsx src/components/ui/sheet.tsx src/components/ui/sheet.test.tsx
git commit -m "feat: add Dialog and Sheet primitives"
```

---

### Task 5: DropdownMenu primitive

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx`
- Test: `src/components/ui/dropdown-menu.test.tsx`

**Interfaces:**
- Consumes: `cn` (Task 2).
- Produces: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuGroup`, `DropdownMenuPortal`,
  `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator` from
  `src/components/ui/dropdown-menu.tsx` — used by Task 10 (Creator Switcher).

- [ ] **Step 1: Install Radix DropdownMenu**

```bash
pnpm add @radix-ui/react-dropdown-menu
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/components/ui/dropdown-menu.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./dropdown-menu";

describe("DropdownMenu", () => {
  it("opens on trigger click and calls onSelect for the chosen item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Thais Miranda</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Creators</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onSelect}>Bruno Alves</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.queryByText("Bruno Alves")).not.toBeInTheDocument();

    await user.click(screen.getByText("Thais Miranda"));
    const item = await screen.findByText("Bruno Alves");
    await user.click(item);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/dropdown-menu.test.tsx`
Expected: FAIL — `./dropdown-menu` doesn't exist.

- [ ] **Step 4: Implement DropdownMenu**

```typescript
// src/components/ui/dropdown-menu.tsx
"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-card p-1 text-foreground shadow-md",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/dropdown-menu.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add package.json pnpm-lock.yaml src/components/ui/dropdown-menu.tsx src/components/ui/dropdown-menu.test.tsx
git commit -m "feat: add DropdownMenu primitive"
```

---

### Task 6: Popover primitive

**Files:**
- Create: `src/components/ui/popover.tsx`
- Test: `src/components/ui/popover.test.tsx`

**Interfaces:**
- Consumes: `cn` (Task 2).
- Produces: `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent` from
  `src/components/ui/popover.tsx`. Not consumed by any other task in this plan — it's a
  foundation primitive for later screens (e.g. Filters Bar).

- [ ] **Step 1: Install Radix Popover**

```bash
pnpm add @radix-ui/react-popover
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/components/ui/popover.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

describe("Popover", () => {
  it("opens on trigger click and shows its content", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Filtros</PopoverTrigger>
        <PopoverContent>Status: Aberto</PopoverContent>
      </Popover>,
    );

    expect(screen.queryByText("Status: Aberto")).not.toBeInTheDocument();

    await user.click(screen.getByText("Filtros"));
    expect(await screen.findByText("Status: Aberto")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/popover.test.tsx`
Expected: FAIL — `./popover` doesn't exist.

- [ ] **Step 4: Implement Popover**

```typescript
// src/components/ui/popover.tsx
"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-md border border-border bg-card p-4 text-foreground shadow-md outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/popover.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add package.json pnpm-lock.yaml src/components/ui/popover.tsx src/components/ui/popover.test.tsx
git commit -m "feat: add Popover primitive"
```

---

### Task 7: Table primitive

**Files:**
- Create: `src/components/ui/table.tsx`
- Test: `src/components/ui/table.test.tsx`

**Interfaces:**
- Consumes: `cn` (Task 2).
- Produces: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` from
  `src/components/ui/table.tsx`. Plain semantic-HTML wrapper — no TanStack Table wiring (out
  of scope; that's a later, screen-specific plan).

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/ui/table.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

describe("Table", () => {
  it("renders a header row and body rows as semantic table markup", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Empresa</TableHead>
            <TableHead>Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Bella Cosméticos</TableCell>
            <TableCell>R$ 5.000</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Empresa" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Bella Cosméticos" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/table.test.tsx`
Expected: FAIL — `./table` doesn't exist.

- [ ] **Step 3: Implement Table**

```typescript
// src/components/ui/table.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-border", className)} {...props} />;
}

function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-border transition-colors hover:bg-muted", className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-9 px-3 text-left align-middle text-xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/table.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/ui/table.tsx src/components/ui/table.test.tsx
git commit -m "feat: add Table primitive"
```

---

### Task 8: Organization context helper (dev-transitional)

**Files:**
- Create: `src/lib/organization.ts`
- Test: `src/lib/organization.test.ts`

**Interfaces:**
- Produces: `getDevOrganizationId(): string` from `src/lib/organization.ts` — the single point
  every later component/route reads `organizationId` through. Consumed by Task 12 (root
  layout). Throws if `NEXT_PUBLIC_DEV_ORGANIZATION_ID` is unset — no hardcoded fallback.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/organization.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { getDevOrganizationId } from "./organization";

describe("getDevOrganizationId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the configured organization id", () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_ORGANIZATION_ID", "11111111-1111-1111-1111-111111111111");
    expect(getDevOrganizationId()).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("throws an explicit error when the env var is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_ORGANIZATION_ID", "");
    expect(() => getDevOrganizationId()).toThrow(/NEXT_PUBLIC_DEV_ORGANIZATION_ID/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/organization.test.ts`
Expected: FAIL — `./organization` doesn't exist.

- [ ] **Step 3: Implement `getDevOrganizationId`**

```typescript
// src/lib/organization.ts
// Transitional, development-only mechanism: no auth/session exists yet, so
// there's no way to derive the current organization from a request. Every
// component or API call that needs `organizationId` on the frontend must go
// through this single function -- never read
// `process.env.NEXT_PUBLIC_DEV_ORGANIZATION_ID` directly elsewhere. When
// authentication/session is implemented, this function's body is replaced
// with session-derived resolution; callers don't change.
//
// This is NOT a security boundary -- it does not provide tenant isolation by
// itself. Isolation is enforced by the backend (RLS + explicit
// organizationId predicates in every repository), the same as it is for any
// other caller of these APIs.
export function getDevOrganizationId(): string {
  const value = process.env.NEXT_PUBLIC_DEV_ORGANIZATION_ID;
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_DEV_ORGANIZATION_ID is not set. This is a development-only " +
        "transitional mechanism used until authentication/session is implemented -- " +
        "set it in .env.local to a real organization id from your local database.",
    );
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/organization.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite, then commit**

```bash
pnpm test
git add src/lib/organization.ts src/lib/organization.test.ts
git commit -m "feat: add getDevOrganizationId transitional helper"
```

---

### Task 9: Responsive Sidebar

**Files:**
- Create: `src/components/shell/sidebar.tsx`
- Test: `src/components/shell/sidebar.test.tsx`

**Interfaces:**
- Consumes: `Button` (Task 2), `Sheet`/`SheetContent`/`SheetTrigger`/`SheetTitle` (Task 4),
  `cn` (Task 2).
- Produces: `SIDEBAR_NAV_ITEMS: SidebarNavItem[]` (the shell's top-level navigation list —
  labels/icons/hrefs only, no page content) from `src/components/shell/sidebar.tsx`. Consumed
  by Task 11 (Command Palette, as its "Navigate" group) and Task 12 (root layout).
- Produces: `SidebarDesktop` (fixed sidebar, hidden below `md`, icon-only between `md` and
  `lg`, full width with labels at `lg`+) and `SidebarMobile` (menu-icon trigger + `Sheet`
  drawer, visible only below `md`) from the same file.

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/shell/sidebar.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
}));

import { SidebarDesktop, SidebarMobile, SIDEBAR_NAV_ITEMS } from "./sidebar";

describe("SidebarDesktop", () => {
  it("renders every top-level nav item and marks the current route as active", () => {
    render(<SidebarDesktop />);

    for (const item of SIDEBAR_NAV_ITEMS) {
      expect(screen.getByRole("link", { name: new RegExp(item.label) })).toBeInTheDocument();
    }

    const activeLink = screen.getByRole("link", { name: /Inbox/ });
    expect(activeLink.className).toContain("text-primary");
  });
});

describe("SidebarMobile", () => {
  it("opens the navigation drawer when the menu trigger is tapped", async () => {
    const user = userEvent.setup();
    render(<SidebarMobile />);

    await user.click(screen.getByRole("button", { name: "Abrir menu" }));
    expect(await screen.findByRole("link", { name: /Pipeline/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/shell/sidebar.test.tsx`
Expected: FAIL — `./sidebar` doesn't exist.

- [ ] **Step 3: Implement Sidebar**

```typescript
// src/components/shell/sidebar.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Contact,
  FileText,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export interface SidebarNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

// Top-level product areas only -- labels, icons, and routes. No page content
// or screen-specific UX is implied here; each area gets its own spec later.
export const SIDEBAR_NAV_ITEMS: SidebarNavItem[] = [
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Pipeline", href: "/pipeline", icon: KanbanSquare },
  { label: "Proposals", href: "/proposals", icon: FileText },
  { label: "Companies", href: "/companies", icon: Building2 },
  { label: "Contacts", href: "/contacts", icon: Contact },
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-3">
      {SIDEBAR_NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {/* Hidden at tablet width (md, icon-only rail), visible on
                mobile (default) and desktop (lg+) -- see spec §4's Sidebar
                row: "Fixa, colapsável para ícones" at tablet. */}
            <span className="md:hidden lg:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarDesktop() {
  return (
    <aside className="hidden md:flex md:w-16 md:flex-col md:border-r md:border-border md:bg-card lg:w-60">
      <div className="hidden px-4 py-4 text-sm font-semibold tracking-wide text-muted-foreground lg:block">
        PUBLYFLOW
      </div>
      <SidebarNav />
    </aside>
  );
}

function SidebarMobile() {
  const [open, setOpen] = React.useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11 md:hidden" aria-label="Abrir menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetTitle className="sr-only">Navegação</SheetTitle>
        <div className="px-4 py-4 text-sm font-semibold tracking-wide text-muted-foreground">
          PUBLYFLOW
        </div>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

export { SidebarDesktop, SidebarMobile, SidebarNav };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/shell/sidebar.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/shell/sidebar.tsx src/components/shell/sidebar.test.tsx
git commit -m "feat: add responsive Sidebar (fixed desktop/tablet, Drawer mobile)"
```

---

### Task 10: Creator context + Creator Switcher + Header

**Files:**
- Create: `src/components/shell/creator-context.tsx`
- Create: `src/components/shell/creator-switcher.tsx`
- Create: `src/components/shell/header.tsx`
- Test: `src/components/shell/creator-switcher.test.tsx`

**Interfaces:**
- Consumes: `DropdownMenu`/`DropdownMenuContent`/`DropdownMenuItem`/`DropdownMenuLabel`/
  `DropdownMenuSeparator`/`DropdownMenuTrigger` (Task 5), `Button` (Task 2), `SidebarMobile`
  (Task 9), `Creator` type from `src/repositories/creators.repository.ts` (type-only import —
  no repository runtime code is bundled into the client).
- Produces: `CreatorProvider({ creators, children })` and `useCreatorContext()` from
  `src/components/shell/creator-context.tsx` — the global "current creator" context described
  in the spec (§2 decision 10). `creators` is supplied by the parent (Task 12's root layout,
  which fetches it server-side); this component does no fetching itself.
- Produces: `CreatorSwitcher` from `src/components/shell/creator-switcher.tsx` — reads/writes
  `useCreatorContext()`, persists the selection to `localStorage` under the key
  `"publyflow:selected-creator-id"` so it survives navigation and reloads.
- Produces: `Header` from `src/components/shell/header.tsx` — composes `SidebarMobile` +
  `CreatorSwitcher`. Task 12 adds `CommandPalette` to it.

- [ ] **Step 1: Implement the Creator context**

No test-first step for this file alone — its only behavior (persist-to-localStorage,
default-to-first-creator) is exercised end-to-end by the `CreatorSwitcher` test in Step 3,
the same way `cn()`'s two-line body didn't need its own red/green cycle either.

```typescript
// src/components/shell/creator-context.tsx
"use client";

import * as React from "react";
import type { Creator } from "@/repositories/creators.repository";

const STORAGE_KEY = "publyflow:selected-creator-id";

interface CreatorContextValue {
  creators: Creator[];
  selectedCreatorId: string | null;
  selectCreator: (creatorId: string) => void;
}

const CreatorContext = React.createContext<CreatorContextValue | null>(null);

export function CreatorProvider({
  creators,
  children,
}: {
  creators: Creator[];
  children: React.ReactNode;
}) {
  const [selectedCreatorId, setSelectedCreatorId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const isStoredValid = creators.some((creator) => creator.id === stored);
    setSelectedCreatorId(isStoredValid ? stored : (creators[0]?.id ?? null));
  }, [creators]);

  const selectCreator = React.useCallback((creatorId: string) => {
    setSelectedCreatorId(creatorId);
    window.localStorage.setItem(STORAGE_KEY, creatorId);
  }, []);

  const value = React.useMemo(
    () => ({ creators, selectedCreatorId, selectCreator }),
    [creators, selectedCreatorId, selectCreator],
  );

  return <CreatorContext.Provider value={value}>{children}</CreatorContext.Provider>;
}

export function useCreatorContext(): CreatorContextValue {
  const ctx = React.useContext(CreatorContext);
  if (!ctx) {
    throw new Error("useCreatorContext must be used within a CreatorProvider");
  }
  return ctx;
}
```

- [ ] **Step 2: Write the failing CreatorSwitcher test**

```typescript
// src/components/shell/creator-switcher.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Creator } from "@/repositories/creators.repository";
import { CreatorProvider } from "./creator-context";
import { CreatorSwitcher } from "./creator-switcher";

const creators: Creator[] = [
  {
    id: "c1",
    organizationId: "org1",
    userId: "u1",
    displayName: "Thais Miranda",
    instagramHandle: null,
    createdAt: new Date("2026-01-01"),
  },
  {
    id: "c2",
    organizationId: "org1",
    userId: "u2",
    displayName: "Bruno Alves",
    instagramHandle: null,
    createdAt: new Date("2026-01-02"),
  },
];

describe("CreatorSwitcher", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the first creator and switches selection on click, persisting it", async () => {
    const user = userEvent.setup();
    render(
      <CreatorProvider creators={creators}>
        <CreatorSwitcher />
      </CreatorProvider>,
    );

    expect(await screen.findByText("Thais Miranda")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Thais Miranda/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Bruno Alves/ }));

    expect(screen.getByRole("button", { name: /Bruno Alves/ })).toBeInTheDocument();
    expect(window.localStorage.getItem("publyflow:selected-creator-id")).toBe("c2");
  });

  it("shows a fallback message when the organization has no creators", () => {
    render(
      <CreatorProvider creators={[]}>
        <CreatorSwitcher />
      </CreatorProvider>,
    );

    expect(screen.getByText("Nenhum creator cadastrado")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/components/shell/creator-switcher.test.tsx`
Expected: FAIL — `./creator-switcher` doesn't exist.

- [ ] **Step 4: Implement CreatorSwitcher**

```typescript
// src/components/shell/creator-switcher.tsx
"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCreatorContext } from "./creator-context";

export function CreatorSwitcher() {
  const { creators, selectedCreatorId, selectCreator } = useCreatorContext();
  const selected = creators.find((creator) => creator.id === selectedCreatorId);

  if (creators.length === 0) {
    return <span className="text-sm text-muted-foreground">Nenhum creator cadastrado</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-11 min-w-0 justify-between gap-2 px-3 md:h-9">
          <span className="max-w-[10rem] truncate">
            {selected?.displayName ?? "Selecionar creator"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Creators</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {creators.map((creator) => (
          <DropdownMenuItem
            key={creator.id}
            onSelect={() => selectCreator(creator.id)}
            className="justify-between"
          >
            {creator.displayName}
            {creator.id === selectedCreatorId && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

The `h-11 md:h-9` sizing follows the touch-target Global Constraint: 44px tall by default
(mobile/tablet), shrinking to the dense 36px desktop size at `md`+ — note this means the
switcher is already dense at tablet width, which is intentional (it's a header control, not a
list item subject to the Sidebar's icon-only tablet treatment).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/shell/creator-switcher.test.tsx`
Expected: PASS

- [ ] **Step 6: Implement Header**

No dedicated test for `Header` alone in this task — it's a thin composition of already-tested
`SidebarMobile` and `CreatorSwitcher`; Task 12's manual shell verification covers it end to
end once `CommandPalette` (Task 11) is added to it.

```typescript
// src/components/shell/header.tsx
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
```

- [ ] **Step 7: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/shell/creator-context.tsx src/components/shell/creator-switcher.tsx src/components/shell/creator-switcher.test.tsx src/components/shell/header.tsx
git commit -m "feat: add Creator context, Creator Switcher, and Header"
```

---

### Task 11: Command Palette

**Files:**
- Create: `src/components/ui/command.tsx`
- Create: `src/components/shell/command-palette.tsx`
- Test: `src/components/shell/command-palette.test.tsx`

**Interfaces:**
- Consumes: `Dialog`/`DialogContent`/`DialogTitle` (Task 4), `Button` (Task 2),
  `SIDEBAR_NAV_ITEMS` (Task 9), `cn` (Task 2).
- Produces: `Command`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`,
  `CommandItem` from `src/components/ui/command.tsx` (thin styled wrapper around `cmdk`).
- Produces: `CommandPalette` from `src/components/shell/command-palette.tsx` — a button
  trigger (visible text+shortcut on desktop, icon-only on mobile) plus a `⌘K`/`Ctrl+K`
  keyboard shortcut, opening a `Dialog` with a searchable list of `SIDEBAR_NAV_ITEMS`.
  Consumed by Task 12 (added to `Header`).

- [ ] **Step 1: Install cmdk**

```bash
pnpm add cmdk
```

- [ ] **Step 2: Implement the Command UI primitive**

No test-first step for this file — it's a styling-only wrapper around `cmdk`'s own
components, with no behavior of its own; `cmdk`'s search/filter/keyboard-navigation logic is
exercised by the `CommandPalette` test in Step 4.

```typescript
// src/components/ui/command.tsx
"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg bg-card text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3">
      <Search className="size-4 text-muted-foreground" />
      <CommandPrimitive.Input
        className={cn(
          "flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn("max-h-80 overflow-y-auto overflow-x-hidden p-1", className)}
      {...props}
    />
  );
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground" {...props} />;
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-[selected=true]:bg-muted data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
```

- [ ] **Step 3: Write the failing CommandPalette test**

```typescript
// src/components/shell/command-palette.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { CommandPalette } from "./command-palette";

describe("CommandPalette", () => {
  it("opens with Ctrl+K and navigates when a nav item is selected", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    expect(screen.queryByPlaceholderText(/Buscar ou executar/)).not.toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByPlaceholderText(/Buscar ou executar/)).toBeInTheDocument();

    await user.click(screen.getByText("Pipeline"));
    expect(push).toHaveBeenCalledWith("/pipeline");
  });

  it("opens when the visible trigger button is clicked", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.click(screen.getByText("Buscar..."));
    expect(await screen.findByPlaceholderText(/Buscar ou executar/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run src/components/shell/command-palette.test.tsx`
Expected: FAIL — `./command-palette` doesn't exist.

- [ ] **Step 5: Implement CommandPalette**

```typescript
// src/components/shell/command-palette.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SIDEBAR_NAV_ITEMS } from "./sidebar";

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-0">
          <DialogTitle className="sr-only">Command Palette</DialogTitle>
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
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/components/shell/command-palette.test.tsx`
Expected: PASS

- [ ] **Step 7: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add package.json pnpm-lock.yaml src/components/ui/command.tsx src/components/shell/command-palette.tsx src/components/shell/command-palette.test.tsx
git commit -m "feat: add Command Palette (Ctrl+K / Cmd+K)"
```

---

### Task 12: Application shell assembly

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/components/shell/header.tsx`

**Interfaces:**
- Consumes: `CreatorService.listByOrganization` (already implemented, merged to `main`),
  `getDevOrganizationId` (Task 8), `CreatorProvider` (Task 10), `SidebarDesktop` (Task 9),
  `Header` (Task 10), `CommandPalette` (Task 11).
- Produces: the assembled application shell — every route rendered under this root layout now
  gets the Sidebar/Header/Creator context/Command Palette automatically.

- [ ] **Step 1: Add `CommandPalette` to the Header**

Read the current content of `src/components/shell/header.tsx` (written in Task 10) before
editing.

```typescript
// src/components/shell/header.tsx
import { SidebarMobile } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { CreatorSwitcher } from "./creator-switcher";

export function Header() {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4">
      <SidebarMobile />
      <CommandPalette />
      <div className="flex-1" />
      <CreatorSwitcher />
    </header>
  );
}
```

- [ ] **Step 2: Assemble the root layout**

Read the current content of `src/app/layout.tsx` (last touched in Task 1, font-only) before
editing.

```typescript
// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { db } from "@/db";
import { CreatorService } from "@/services/creator.service";
import { getDevOrganizationId } from "@/lib/organization";
import { CreatorProvider } from "@/components/shell/creator-context";
import { SidebarDesktop } from "@/components/shell/sidebar";
import { Header } from "@/components/shell/header";

// Every route under this layout reads the current organization's creators
// via a live DB call (through CreatorService). Next must not attempt to
// prerender this at build time -- there's no guarantee a reachable Postgres
// or NEXT_PUBLIC_DEV_ORGANIZATION_ID exists in a build environment, and this
// data is inherently per-request anyway (it will become per-session once
// auth exists).
export const dynamic = "force-dynamic";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PublyFlow",
  description: "Gestão comercial para creators e assessorias",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const organizationId = getDevOrganizationId();
  const creators = await CreatorService.listByOrganization(db, organizationId);

  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <CreatorProvider creators={creators}>
          <div className="flex h-screen overflow-hidden">
            <SidebarDesktop />
            <div className="flex flex-1 flex-col overflow-hidden">
              <Header />
              <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
            </div>
          </div>
        </CreatorProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify the app builds**

```bash
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
```

Expected: builds successfully. `force-dynamic` means this route isn't prerendered, so the
build doesn't attempt to reach a database.

- [ ] **Step 4: Manual smoke check**

This task wires a Server Component (DB call + env var) into every route; the pieces it
composes (`SidebarDesktop`, `Header`, `CreatorSwitcher`, `CommandPalette`) already have their
own automated tests from Tasks 9–11, so this step is a manual, documented check rather than a
new automated one — mocking the DB and env var to unit-test the root layout itself would cost
more than it proves here.

1. Ensure a local Postgres is running with at least one organization and one creator (use the
   same `docker-compose.test.yml` database or a dev database — whichever this project's
   `pnpm dev` is configured to point at).
2. Set `NEXT_PUBLIC_DEV_ORGANIZATION_ID` in `.env.local` to that organization's id.
3. Run `pnpm dev` and open the app in a browser.
4. Confirm: Sidebar renders (all 6 nav items) and highlights the active route; Header shows
   the Command Palette trigger and Creator Switcher with the first creator selected; `⌘K`/
   `Ctrl+K` opens the Command Palette and navigating via it works; resizing to <768px hides the
   fixed Sidebar and shows a working hamburger-triggered Drawer instead; resizing to the
   768–1023px range shows the Sidebar as icon-only.

- [ ] **Step 5: Run the full suite, then commit**

```bash
pnpm test
git add src/app/layout.tsx src/components/shell/header.tsx
git commit -m "feat: assemble the PublyFlow application shell"
```

---

## Self-Review

**Spec coverage:**
- §2 decisions 1 (shadcn/Radix), 5 (Lucide), 12 (Drawer vs Modal usage rule, encoded as a
  Global Constraint and honored in every component's design — e.g. `SidebarMobile` uses
  `Sheet`, not `Dialog`), 13 (Command Palette from v1) — Tasks 2, 4, 5, 6, 9, 11.
- §2 decisions 2/3/4 (light-mode-only tokens, palette, typography) — Task 1.
- §2 decisions 6/7 (radius, spacing) — Task 1.
- §2 decisions 8/9 (responsive categories, touch targets) — Tasks 9, 10, 11 (every mobile
  trigger is sized `size-11`/`h-11`).
- §2 decision 10 (Creator Switcher, header, persists across navigation) — Task 10.
- §2 decision 11 (creator vs org scoping) — recorded as a Global Constraint; no task
  implements a screen that consumes it yet (correctly out of scope).
- §2 decisions 14/15/16 (TanStack Table base only — no wiring —, dnd-kit deferred, cmdk) —
  Task 7 (plain Table, no TanStack), dnd-kit explicitly absent, Task 11 (cmdk).
- §2 decision 17 (Rich Block Editor deferred) — correctly absent from every task.
- §3 (exact palette values) — Task 1's token list and test.
- §4 (responsive shell table + per-component rules) — Task 9 (Sidebar), Task 10 (Creator
  Switcher sizing), Task 11 (Command Palette mobile/desktop triggers); Dialog/Sheet's
  Step-0 accessibility note addresses the spec's explicit correction about not assuming
  Radix's default modal behavior is automatically correct for every future non-modal usage.
- §5 (typography scale + rules) — Task 1's constraints section; no component in this plan
  hardcodes a font size below 12px or applies the dense 13px scale to `Input` (Input uses
  `text-sm`, i.e. 14px, per the spec's "inputs devem priorizar legibilidade" rule).
- §6 (exact in-scope/out-of-scope component list) — every task maps 1:1 to an "entra" item;
  every "não entra" item (Kanban, DataTable advanced, Rich Block Editor, dnd-kit, any screen
  UX, dark mode) is verified absent from every task.
- Global focus-visible rule — Task 1's CSS rule; every interactive primitive relies on it
  rather than reimplementing its own focus style.
- `organizationId` transitional mechanism (from the follow-up clarification, not the spec
  itself, but binding) — Task 8, consumed only by Task 12, never read directly elsewhere.

**Placeholder scan:** none found — every step has literal, complete code.

**Type consistency:** `SIDEBAR_NAV_ITEMS`/`SidebarNavItem` (Task 9) is imported by name in
Task 11 (`CommandPalette`) and Task 12 (indirectly, via `Header`/`SidebarDesktop`) with no
renaming. `CreatorProvider`/`useCreatorContext` (Task 10) signatures match their usage in
Task 12 (`<CreatorProvider creators={creators}>`, where `creators` is exactly the
`Creator[]` returned by `CreatorService.listByOrganization`). `getDevOrganizationId()`'s
zero-argument, string-returning signature (Task 8) matches its single call site in Task 12.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-design-system-v1.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
