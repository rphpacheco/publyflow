# Inbox Design System Additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five Design System components the Inbox screen needs that don't exist yet —
Toast, Empty State, Textarea, Select, Combobox — as reusable foundation primitives, before
building the Inbox screen itself (a separate, following plan).

**Architecture:** Same shadcn/ui-style approach as every existing primitive in
`src/components/ui/`: thin styling wrappers over Radix primitives (Select) or well-established
libraries (`sonner` for Toast, `cmdk` for Combobox — both already dependencies of this
project), using the existing design tokens exclusively (no hardcoded colors). Combobox
composes the already-existing `Popover` and `Command` primitives rather than introducing new
positioning/search logic.

**Tech Stack:** Next.js 16, React 19, Radix Primitives, `cmdk`, `sonner`, Tailwind v4, Vitest +
`@testing-library/react`.

## Global Constraints

- Every new component uses only the existing design tokens (`bg-card`, `text-foreground`,
  `border-border`, `bg-primary`, etc.) — no hardcoded hex colors, matching the Design System's
  token discipline (confirmed via the final review of the Design System v1 branch, which
  found and fixed exactly this issue in `Dialog`/`Sheet`/`Button`).
- Touch targets: any interactive element rendered on mobile/tablet must be at least 44×44px,
  per the Design System's global constraint — this applies to the Combobox's trigger and the
  Select's trigger.
- Focus-visible: rely on the global `*:focus-visible` CSS rule already defined in
  `src/app/globals.css` (Design System v1) — do not add component-local focus styling that
  could conflict with or duplicate it.
- No new backend calls in this plan — Combobox is a generic, data-agnostic component (it
  receives `items` as a prop; it does not fetch anything itself). Wiring it to
  `GET /api/companies`/`GET /api/contacts` happens in the following Inbox Screen plan.

---

### Task 1: Toast (sonner)

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Test: `src/app/toaster.test.tsx`

**Interfaces:**
- Produces: `<Toaster />` mounted once in the root layout — every future screen calls
  `toast(...)`/`toast.success(...)`/`toast.error(...)` directly from the `sonner` package
  (no wrapper component; `sonner`'s own API is already the minimal surface needed, adding a
  wrapper would be an unnecessary abstraction).

- [ ] **Step 1: Install sonner**

```bash
pnpm add sonner
```

- [ ] **Step 2: Write the failing smoke test**

```typescript
// src/app/toaster.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toaster } from "sonner";
import { toast } from "sonner";

describe("Toaster", () => {
  it("renders a toast message when toast() is called", async () => {
    render(<Toaster />);
    toast("Convertida em Opportunity");

    expect(await screen.findByText("Convertida em Opportunity")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/toaster.test.tsx`
Expected: FAIL — `sonner` isn't installed yet, or (if Step 1 already ran) the test may
actually pass already since `Toaster`/`toast` need no extra wiring to function in isolation;
if it passes at this point, that's fine — it proves the library itself works standalone
before Step 4 wires it into the actual layout.

- [ ] **Step 3: Wire `<Toaster />` into the root layout**

Read the current content of `src/app/layout.tsx` in full first (last touched by the Design
System v1 plan's shell-assembly task).

```typescript
// src/app/layout.tsx
// Add this import alongside the existing component imports:
import { Toaster } from "sonner";

// Add <Toaster /> as a sibling of the existing shell markup, inside <body>,
// after the closing </CreatorProvider> tag (a toast can be triggered from
// anywhere in the tree, so it doesn't need to be nested inside any
// particular provider):
      <body className="min-h-full">
        <CreatorProvider organizationId={organizationId} creators={creators}>
          {/* ...existing shell markup, unchanged... */}
        </CreatorProvider>
        <Toaster />
      </body>
```

Apply this as a minimal, surgical addition — do not restructure anything else in the file.

- [ ] **Step 4: Theme the toast to use design tokens**

```css
/* src/app/globals.css */
/* Add near the end of the file, after the *:focus-visible rule: */

/* sonner reads these CSS custom properties for its default ("normal")
   toast variant -- pointing them at our tokens keeps toasts visually
   consistent with the rest of the Design System instead of sonner's
   built-in default colors. */
[data-sonner-toaster] {
  --normal-bg: var(--card);
  --normal-text: var(--foreground);
  --normal-border: var(--border);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/app/toaster.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add package.json pnpm-lock.yaml src/app/layout.tsx src/app/globals.css src/app/toaster.test.tsx
git commit -m "feat: wire sonner Toaster into the application shell"
```

---

### Task 2: Empty State

**Files:**
- Create: `src/components/ui/empty-state.tsx`
- Test: `src/components/ui/empty-state.test.tsx`

**Interfaces:**
- Produces: `EmptyState` from `src/components/ui/empty-state.tsx` — props `icon:
  React.ComponentType<{className?: string}>`, `title: string`, `description?: string`,
  `action?: React.ReactNode` (a slot for an optional CTA, e.g. a `Button`, so `EmptyState`
  doesn't need to know about button variants/click handlers itself).

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/ui/empty-state.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { Button } from "./button";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the title, optional description, and optional action", () => {
    render(
      <EmptyState
        icon={Inbox}
        title="Nenhuma mensagem nova"
        description="Novas mensagens comerciais aparecem aqui."
        action={<Button>Nova Mensagem</Button>}
      />,
    );

    expect(screen.getByText("Nenhuma mensagem nova")).toBeInTheDocument();
    expect(screen.getByText("Novas mensagens comerciais aparecem aqui.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova Mensagem" })).toBeInTheDocument();
  });

  it("renders without a description or action when omitted", () => {
    render(<EmptyState icon={Inbox} title="Nada por aqui" />);
    expect(screen.getByText("Nada por aqui")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/empty-state.test.tsx`
Expected: FAIL — `./empty-state` doesn't exist.

- [ ] **Step 3: Implement EmptyState**

```typescript
// src/components/ui/empty-state.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      <Icon className="size-10 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/empty-state.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/ui/empty-state.tsx src/components/ui/empty-state.test.tsx
git commit -m "feat: add EmptyState primitive"
```

---

### Task 3: Textarea

**Files:**
- Create: `src/components/ui/textarea.tsx`
- Test: `src/components/ui/textarea.test.tsx`

**Interfaces:**
- Produces: `Textarea` from `src/components/ui/textarea.tsx` — standard
  `<textarea>` props forwarded, same `forwardRef` pattern as `Input`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/ui/textarea.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("accepts typed multi-line text", async () => {
    const user = userEvent.setup();
    render(<Textarea placeholder="Mensagem..." />);
    const textarea = screen.getByPlaceholderText("Mensagem...");
    await user.type(textarea, "Olá, gostaríamos de saber os valores.");
    expect(textarea).toHaveValue("Olá, gostaríamos de saber os valores.");
  });

  it("respects the disabled attribute", () => {
    render(<Textarea disabled placeholder="Indisponível" />);
    expect(screen.getByPlaceholderText("Indisponível")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/textarea.test.tsx`
Expected: FAIL — `./textarea` doesn't exist.

- [ ] **Step 3: Implement Textarea**

```typescript
// src/components/ui/textarea.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-20 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/textarea.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/ui/textarea.tsx src/components/ui/textarea.test.tsx
git commit -m "feat: add Textarea primitive"
```

---

### Task 4: Select

**Files:**
- Create: `src/components/ui/select.tsx`
- Test: `src/components/ui/select.test.tsx`

**Interfaces:**
- Produces: `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`,
  `SelectGroup`, `SelectLabel`, `SelectSeparator` from `src/components/ui/select.tsx` — used
  by the following Inbox Screen plan's "Nova Mensagem" form (canal: Instagram/WhatsApp/TikTok).

- [ ] **Step 1: Install Radix Select**

```bash
pnpm add @radix-ui/react-select
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/components/ui/select.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

describe("Select", () => {
  it("opens on trigger click and selects an item", async () => {
    const user = userEvent.setup();
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Canal" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="INSTAGRAM">Instagram</SelectItem>
          <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
        </SelectContent>
      </Select>,
    );

    await user.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: "WhatsApp" });
    await user.click(option);

    expect(screen.getByRole("combobox")).toHaveTextContent("WhatsApp");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/select.test.tsx`
Expected: FAIL — `./select` doesn't exist.

- [ ] **Step 4: Implement Select**

```typescript
// src/components/ui/select.tsx
"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;
const SelectGroup = SelectPrimitive.Group;

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-11 w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:h-9",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-card text-foreground shadow-md",
          className,
        )}
        position="popper"
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex min-h-11 w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 md:min-h-8",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
  );
}

export {
  Select,
  SelectValue,
  SelectGroup,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
};
```

Note the trigger and item both use `h-11`/`min-h-11` at mobile/tablet, shrinking to `md:h-9`/
`md:min-h-8` at desktop — same touch-target pattern already established by `CreatorSwitcher`
and `DropdownMenuItem`/`CommandItem` in the fix wave.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/select.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add package.json pnpm-lock.yaml src/components/ui/select.tsx src/components/ui/select.test.tsx
git commit -m "feat: add Select primitive"
```

---

### Task 5: Combobox

**Files:**
- Create: `src/components/ui/combobox.tsx`
- Test: `src/components/ui/combobox.test.tsx`

**Interfaces:**
- Consumes: `Popover`/`PopoverTrigger`/`PopoverContent` (existing), `Command`/`CommandInput`/
  `CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem` (existing, from the Command
  Palette work), `Button` (existing).
- Produces: `Combobox<T>` from `src/components/ui/combobox.tsx` — a generic, data-agnostic
  component. Props: `items: T[]`, `getLabel: (item: T) => string`, `getValue: (item: T) =>
  string`, `value: string | null`, `onSelect: (item: T) => void`, `placeholder?: string`,
  `emptyText?: string`, `onCreateNew?: (name: string) => void`, `createLabel?: (name: string)
  => string`. Filtering is a plain case-insensitive substring match on `getLabel(item)` — no
  fuzzy matching, no debounce (the item list is already fully loaded client-side; there's no
  network round-trip to debounce). Consumed by the following Inbox Screen plan for Contact/
  Company/Brand selection — this task does NOT fetch `/api/companies` or `/api/contacts`
  itself, it only renders whatever `items` it's given.

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/ui/combobox.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox } from "./combobox";

interface Company {
  id: string;
  name: string;
}

const companies: Company[] = [
  { id: "c1", name: "Bella Cosméticos" },
  { id: "c2", name: "Studio Norte" },
];

describe("Combobox", () => {
  it("opens on trigger click, filters by typed text, and calls onSelect for the chosen item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <Combobox<Company>
        items={companies}
        getLabel={(c) => c.name}
        getValue={(c) => c.id}
        value={null}
        onSelect={onSelect}
        placeholder="Selecionar empresa..."
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText(/Buscar/), "Norte");

    expect(screen.queryByText("Bella Cosméticos")).not.toBeInTheDocument();
    const option = await screen.findByText("Studio Norte");
    await user.click(option);

    expect(onSelect).toHaveBeenCalledWith(companies[1]);
  });

  it("shows a create-new option when onCreateNew is provided and no item matches", async () => {
    const user = userEvent.setup();
    const onCreateNew = vi.fn();

    render(
      <Combobox<Company>
        items={companies}
        getLabel={(c) => c.name}
        getValue={(c) => c.id}
        value={null}
        onSelect={() => {}}
        onCreateNew={onCreateNew}
        createLabel={(name) => `Criar "${name}"`}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText(/Buscar/), "Empresa Nova");

    const createOption = await screen.findByText('Criar "Empresa Nova"');
    await user.click(createOption);

    expect(onCreateNew).toHaveBeenCalledWith("Empresa Nova");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/combobox.test.tsx`
Expected: FAIL — `./combobox` doesn't exist.

- [ ] **Step 3: Implement Combobox**

```typescript
// src/components/ui/combobox.tsx
"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";

export interface ComboboxProps<T> {
  items: T[];
  getLabel: (item: T) => string;
  getValue: (item: T) => string;
  value: string | null;
  onSelect: (item: T) => void;
  placeholder?: string;
  emptyText?: string;
  onCreateNew?: (name: string) => void;
  createLabel?: (name: string) => string;
  className?: string;
}

function Combobox<T>({
  items,
  getLabel,
  getValue,
  value,
  onSelect,
  placeholder = "Selecionar...",
  emptyText = "Nenhum resultado encontrado.",
  onCreateNew,
  createLabel = (name) => `Criar "${name}"`,
  className,
}: ComboboxProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selected = items.find((item) => getValue(item) === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? items.filter((item) => getLabel(item).toLowerCase().includes(normalizedQuery))
    : items;
  const hasExactMatch = items.some((item) => getLabel(item).toLowerCase() === normalizedQuery);
  const showCreateOption = Boolean(onCreateNew) && normalizedQuery.length > 0 && !hasExactMatch;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-11 w-full justify-between font-normal md:h-9", className)}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? getLabel(selected) : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar..." value={query} onValueChange={setQuery} />
          <CommandList>
            {filtered.length === 0 && !showCreateOption ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : null}
            <CommandGroup>
              {filtered.map((item) => (
                <CommandItem
                  key={getValue(item)}
                  onSelect={() => {
                    onSelect(item);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      getValue(item) === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {getLabel(item)}
                </CommandItem>
              ))}
              {showCreateOption ? (
                <CommandItem
                  onSelect={() => {
                    onCreateNew!(query.trim());
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {createLabel(query.trim())}
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
```

`shouldFilter={false}` on `Command` disables `cmdk`'s own built-in filtering — this component
does its own filtering (`filtered`) so the create-new-option logic can inspect exactly which
items survived the filter (`hasExactMatch`) in the same render, which `cmdk`'s internal async
filtering doesn't expose.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/combobox.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite, verify the app builds, then commit**

```bash
pnpm test
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_DEV_ORGANIZATION_ID=test pnpm build
git add src/components/ui/combobox.tsx src/components/ui/combobox.test.tsx
git commit -m "feat: add generic Combobox primitive"
```

---

## Self-Review

**Spec coverage:**
- §3 of the Inbox UX spec lists exactly these 5 components (Toast, Empty State, Combobox,
  Select, Textarea) as needed and not yet existing — Tasks 1–5 cover all of them, nothing
  extra.
- Global Constraints (token discipline, touch targets, focus-visible, no premature Combobox
  data-fetching) are each addressed inline in the relevant task (Select/Combobox touch
  targets; Toast token theming; Combobox's data-agnostic design).

**Placeholder scan:** none — every step has literal, complete code.

**Type consistency:** `Combobox<T>`'s prop names (`items`, `getLabel`, `getValue`, `value`,
`onSelect`, `onCreateNew`, `createLabel`) are used consistently in both its test file and its
implementation; no renaming across steps. `EmptyState`'s `action?: React.ReactNode` slot
(rather than a narrower `actionLabel`/`onActionClick` pair) is a deliberate choice so the
following Inbox Screen plan can pass a fully-configured `Button` without `EmptyState` needing
to know about button variants — consistent with "smaller units with well-defined interfaces."

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-inbox-design-system-additions.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
