# Creator Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OWNER and MANAGER members can list, create and edit creators in the app (`/creators`) without granting the creator any access.

**Architecture:**
- **Validation:** a zod input module normalises and validates the fields.
- **Service:** `CreatorService.register` creates or reuses the `users` row by e-mail and inserts the creator in one tenant transaction. It maps duplicates, including the unique-violation race, to `CreatorEmailTakenError`. `CreatorService.update` edits the display fields.
- **Routes:** `POST /api/creators` and `PATCH /api/creators/[id]` enforce the role. `GET /api/creators` now includes the user's e-mail.
- **Client:** a `/creators` page with a create/edit dialog built on TanStack Query hooks. A sidebar item and a "Cadastrar creator" link in the empty header switcher lead to it.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, TanStack Query, Drizzle + Postgres, zod 4, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-28-creator-registration-design.md`

## Global Constraints

- **Next.js docs:** Next.js 16 — read `node_modules/next/dist/docs/` before writing routes or pages (AGENTS.md).
- **Validation messages** (Portuguese, exact):

  | Field | Rule | Message |
  |---|---|---|
  | `fullName` | trim, required | `Informe o nome completo.` |
  | `fullName` | ≤120 | `Use no máximo 120 caracteres.` |
  | `displayName` | trim, required | `Informe o nome de exibição.` |
  | `displayName` | ≤80 | `Use no máximo 80 caracteres.` |
  | `instagramHandle` | see below | `Use só letras, números, ponto e sublinhado (até 30).` |
  | `email` | trim, lowercase, e-mail format, ≤254 | `Informe um e-mail válido.` |

- **Instagram handle rule:**
  1. strip surrounding spaces and leading `@`;
  2. the rest must match `^[A-Za-z0-9._]{1,30}$`;
  3. store it as `@<handle>`;
  4. store empty or absent as `null`.
- **Responses:**
  - 400 `{ errors: { field: [messages] } }`;
  - 409 `{ "error": "Já existe um creator com este e-mail." }`;
  - 403 `{ "error": "Sem permissão." }`;
  - 404 `{ error: new CreatorNotFoundError(id).message }`.
- **Check order:** session (401) → `isUuid` (404, PATCH only) → role OWNER/MANAGER (403) → body.
- **E-mail:** never editable after creation. An existing `users` row is reused unchanged.
- **Access:** no `organization_members` row is created for creators (no access in this spec).
- **UI copy:**
  - sidebar item: `Creators`;
  - buttons: `Novo creator`, `Editar`, `Cadastrar` (create dialog), `Salvar` (edit dialog);
  - dialog titles: `Novo creator` / `Editar creator`;
  - empty state: `Nenhum creator cadastrado`;
  - toasts: `Creator cadastrado.` / `Creator atualizado.`;
  - switcher link: `Cadastrar creator`;
  - table headers: `Nome de exibição`, `@Instagram`, `E-mail`, `Cadastrado em`.
- **DB:** no migration; implementers never touch a DB outside the Vitest suite.
- **Commands:**
  - pnpm: `/opt/homebrew/bin/pnpm`;
  - full suite: `/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000`;
  - build: `OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build`.
- **Commits:** end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, whatever model you are.
- **Worktree shell:** run plain single commands (no chained git/pnpm with variables, no `cd` elsewhere). Quote paths with `[id]` or `(app)`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/creators/creator-input.ts` | zod schemas for create and update |
| `src/domain/creators/errors.ts` | + `CreatorEmailTakenError` |
| `src/repositories/creators.repository.ts` | + `findByUserIdWithTx`, `updateWithTx`, `listWithEmailByOrganization` |
| `src/services/creator.service.ts` | + `register`, `update` |
| `src/lib/auth/http.ts` | + `forbiddenResponse`, `canManageCreators` |
| `src/app/api/creators/route.ts` | GET (with email), POST |
| `src/app/api/creators/[id]/route.ts` | PATCH |
| `src/lib/api-client.ts` | `ApiError` carries the parsed body |
| `src/hooks/use-creators.ts` | list, create and update hooks |
| `src/components/creators/creator-form-dialog.tsx` | create/edit dialog |
| `src/app/(app)/creators/page.tsx` | the page |
| `src/components/shell/sidebar.tsx`, `creator-switcher.tsx` | navigation |

---

### Task 1: Backend — validation, service, routes

**Files:**
- Create: `src/lib/creators/creator-input.ts`, `src/lib/creators/creator-input.test.ts`, `src/app/api/creators/[id]/route.ts`, `src/app/api/creators/[id]/route.test.ts`
- Modify: `src/domain/creators/errors.ts`, `src/repositories/creators.repository.ts`, `src/services/creator.service.ts`, `src/services/creator.service.test.ts`, `src/lib/auth/http.ts`, `src/app/api/creators/route.ts`, `src/app/api/creators/route.test.ts`, `src/app/api/id-guard.test.ts`

**Interfaces:**
- Produces:
  - `createCreatorSchema` (zod object → `{ fullName: string; displayName: string; instagramHandle: string | null; email: string }`);
  - `updateCreatorSchema` (→ `{ displayName: string; instagramHandle: string | null }`; strips unknown keys such as `email`);
  - `class CreatorEmailTakenError extends Error` (message `Já existe um creator com este e-mail.`);
  - `CreatorsRepository.listWithEmailByOrganization(db, orgId): Promise<CreatorWithEmail[]>`, where `CreatorWithEmail = Creator & { email: string }`;
  - `CreatorService.register(db, orgId, input: CreateCreatorInput): Promise<Creator>`;
  - `CreatorService.update(db, orgId, creatorId, input: UpdateCreatorInput): Promise<Creator | null>`;
  - `CreatorService.listWithEmail(db, orgId): Promise<CreatorWithEmail[]>`;
  - `forbiddenResponse(): NextResponse` (403 `{ error: "Sem permissão." }`);
  - `canManageCreators(role: SessionRole): boolean` (OWNER or MANAGER).
- HTTP:
  - `GET /api/creators` → 200 `CreatorWithEmail[]`, sorted by `displayName`;
  - `POST /api/creators` → 201 `Creator` | 400 | 403 | 409;
  - `PATCH /api/creators/[id]` → 200 `Creator` | 400 | 403 | 404.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/creators/creator-input.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createCreatorSchema, updateCreatorSchema } from "./creator-input";

const base = { fullName: "Thais Rocha", displayName: "Thais", email: " Thais@Example.COM ", instagramHandle: null };
const fieldErrors = (result: { error?: z.ZodError }) => z.flattenError(result.error!).fieldErrors;

describe("creator input", () => {
  it("normalises e-mail and instagram handle", () => {
    expect(createCreatorSchema.parse({ ...base, instagramHandle: " @Thais.Rocha " })).toEqual({
      fullName: "Thais Rocha",
      displayName: "Thais",
      email: "thais@example.com",
      instagramHandle: "@Thais.Rocha",
    });
    expect(createCreatorSchema.parse({ ...base, instagramHandle: "" }).instagramHandle).toBeNull();
    expect(createCreatorSchema.parse({ ...base, instagramHandle: undefined }).instagramHandle).toBeNull();
  });

  it("rejects invalid handles with the Portuguese message", () => {
    for (const handle of ["thais rocha", "a".repeat(31), "thais!"]) {
      const result = createCreatorSchema.safeParse({ ...base, instagramHandle: handle });
      expect(result.success).toBe(false);
      expect(fieldErrors(result).instagramHandle).toEqual(["Use só letras, números, ponto e sublinhado (até 30)."]);
    }
  });

  it("requires names and a valid e-mail", () => {
    const result = createCreatorSchema.safeParse({ fullName: " ", displayName: "", email: "x@y", instagramHandle: null });
    expect(fieldErrors(result)).toEqual({
      fullName: ["Informe o nome completo."],
      displayName: ["Informe o nome de exibição."],
      email: ["Informe um e-mail válido."],
    });
    const long = createCreatorSchema.safeParse({ ...base, fullName: "a".repeat(121), displayName: "b".repeat(81) });
    expect(fieldErrors(long)).toEqual({
      fullName: ["Use no máximo 120 caracteres."],
      displayName: ["Use no máximo 80 caracteres."],
    });
  });

  it("update ignores e-mail", () => {
    expect(updateCreatorSchema.parse({ displayName: "T", instagramHandle: "thais", email: "x@y.z" })).toEqual({
      displayName: "T",
      instagramHandle: "@thais",
    });
  });
});
```

Add to `src/services/creator.service.test.ts` (reuse its imports; add `vi`, `eq`, `users`, `UsersRepository`, `CreatorEmailTakenError`, `OrganizationService` if missing):

```typescript
describe("CreatorService.register / update", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup?.();
  });

  async function org(db: Awaited<ReturnType<typeof withTestDb>>["db"], name = "Org") {
    return OrganizationService.createWithOwner(db, {
      organizationName: name,
      ownerEmail: `owner-${name}@publyflow.test`,
      ownerFullName: "Owner",
    });
  }
  const input = { fullName: "Thais Rocha", displayName: "Thais", email: "thais@publyflow.test", instagramHandle: "@thais" };

  it("creates a user and a creator", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await org(db);
    const creator = await CreatorService.register(db, organization.id, input);
    expect(creator).toMatchObject({ organizationId: organization.id, displayName: "Thais", instagramHandle: "@thais" });
    const [user] = await db.select().from(users).where(eq(users.id, creator.userId));
    expect(user).toMatchObject({ email: "thais@publyflow.test", fullName: "Thais Rocha" });
  });

  it("reuses an existing user by e-mail without changing it", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await org(db);
    const creator = await CreatorService.register(db, organization.id, { ...input, email: owner.email, fullName: "Outro Nome" });
    expect(creator.userId).toBe(owner.id);
    const [user] = await db.select().from(users).where(eq(users.id, owner.id));
    expect(user.fullName).toBe("Owner");
  });

  it("rejects an e-mail that already has a creator in the organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await org(db);
    await CreatorService.register(db, organization.id, input);
    await expect(CreatorService.register(db, organization.id, input)).rejects.toBeInstanceOf(CreatorEmailTakenError);
  });

  it("maps a concurrent insert of the same e-mail (unique violation) to CreatorEmailTakenError", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await org(db);
    await db.insert(users).values({ email: input.email, fullName: "Racer" });
    vi.spyOn(UsersRepository, "findByEmail").mockResolvedValueOnce(null);
    await expect(CreatorService.register(db, organization.id, input)).rejects.toBeInstanceOf(CreatorEmailTakenError);
  });

  it("updates only display fields and never another organization's creator", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await org(db, "A");
    const other = await org(db, "B");
    const creator = await CreatorService.register(db, organization.id, input);

    const updated = await CreatorService.update(db, organization.id, creator.id, { displayName: "Thais R.", instagramHandle: null });
    expect(updated).toMatchObject({ id: creator.id, displayName: "Thais R.", instagramHandle: null, userId: creator.userId });
    expect(await CreatorService.update(db, other.organization.id, creator.id, { displayName: "x", instagramHandle: null })).toBeNull();
  });

  it("lists with e-mail, sorted by display name", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await org(db);
    await CreatorService.register(db, organization.id, { ...input, displayName: "Zoe", email: "zoe@publyflow.test" });
    await CreatorService.register(db, organization.id, { ...input, displayName: "Ana", email: "ana@publyflow.test" });
    const list = await CreatorService.listWithEmail(db, organization.id);
    expect(list.map((c) => [c.displayName, c.email])).toEqual([
      ["Ana", "ana@publyflow.test"],
      ["Zoe", "zoe@publyflow.test"],
    ]);
  });
});
```

Replace `src/app/api/creators/route.test.ts` with the following. First read the existing file and keep any case it has that isn't covered here.

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

const post = (body: unknown) =>
  new Request("http://localhost/api/creators", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const valid = { fullName: "Thais Rocha", displayName: "Thais", email: "thais@publyflow.test", instagramHandle: "thais" };

describe("/api/creators", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(role: "OWNER" | "MANAGER" | "CREATOR" | null = "OWNER") {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const session = role ? { ...ownerSession(organization.id, owner.id), role } : null;
    const route = await importRouteWithSession(() => import("./route"), { db, session });
    return { db, organization, route };
  }

  it("401 without a session", async () => {
    const { route } = await setup(null);
    expect((await route.GET(new Request("http://localhost/api/creators"))).status).toBe(401);
    expect((await route.POST(post(valid))).status).toBe(401);
  });

  it("201 creates for OWNER and MANAGER", async () => {
    const { route } = await setup("MANAGER");
    const response = await route.POST(post(valid));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ displayName: "Thais", instagramHandle: "@thais" });
  });

  it("403 for CREATOR", async () => {
    const { route } = await setup("CREATOR");
    const response = await route.POST(post(valid));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Sem permissão." });
  });

  it("400 with field errors", async () => {
    const { route } = await setup();
    const response = await route.POST(post({ ...valid, email: "x@y", displayName: "" }));
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toMatchObject({
      email: ["Informe um e-mail válido."],
      displayName: ["Informe o nome de exibição."],
    });
  });

  it("409 when the e-mail already has a creator", async () => {
    const { route } = await setup();
    await route.POST(post(valid));
    const response = await route.POST(post(valid));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Já existe um creator com este e-mail." });
  });

  it("GET lists with e-mail, sorted", async () => {
    const { db, organization, route } = await setup();
    await CreatorService.register(db, organization.id, { ...valid, displayName: "Zoe", email: "zoe@publyflow.test", instagramHandle: null });
    await CreatorService.register(db, organization.id, { ...valid, displayName: "Ana", email: "ana@publyflow.test", instagramHandle: null });
    const list = await (await route.GET(new Request("http://localhost/api/creators"))).json();
    expect(list.map((c: { displayName: string; email: string }) => [c.displayName, c.email])).toEqual([
      ["Ana", "ana@publyflow.test"],
      ["Zoe", "zoe@publyflow.test"],
    ]);
  });
});
```

```typescript
// src/app/api/creators/[id]/route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

const patch = (id: string, body: unknown) =>
  new Request(`http://localhost/api/creators/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/creators/[id]", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(role: "OWNER" | "CREATOR" = "OWNER") {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await OrganizationService.createWithOwner(db, { organizationName: "A", ownerEmail: "a@publyflow.test", ownerFullName: "A" });
    const b = await OrganizationService.createWithOwner(db, { organizationName: "B", ownerEmail: "b@publyflow.test", ownerFullName: "B" });
    const creator = await CreatorService.register(db, a.organization.id, {
      fullName: "Thais Rocha",
      displayName: "Thais",
      email: "thais@publyflow.test",
      instagramHandle: null,
    });
    const route = (session: ReturnType<typeof ownerSession>) => importRouteWithSession(() => import("./route"), { db, session });
    return { db, a, b, creator, route, role };
  }

  it("200 updates display fields and ignores e-mail", async () => {
    const { a, creator, route } = await setup();
    const { PATCH } = await route(ownerSession(a.organization.id, a.owner.id));
    const response = await PATCH(patch(creator.id, { displayName: "Thais R.", instagramHandle: "@thais.r", email: "novo@x.com" }), params(creator.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ displayName: "Thais R.", instagramHandle: "@thais.r", userId: creator.userId });
  });

  it("404 for another organization's creator", async () => {
    const { b, creator, route } = await setup();
    const { PATCH } = await route(ownerSession(b.organization.id, b.owner.id));
    const response = await PATCH(patch(creator.id, { displayName: "x", instagramHandle: null }), params(creator.id));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: `Creator ${creator.id} not found` });
  });

  it("403 for CREATOR and 400 with field errors", async () => {
    const { a, creator, route } = await setup();
    const asCreator = await route({ ...ownerSession(a.organization.id, a.owner.id), role: "CREATOR" });
    expect((await asCreator.PATCH(patch(creator.id, { displayName: "x", instagramHandle: null }), params(creator.id))).status).toBe(403);

    const asOwner = await route(ownerSession(a.organization.id, a.owner.id));
    const bad = await asOwner.PATCH(patch(creator.id, { displayName: "", instagramHandle: "a b" }), params(creator.id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).errors).toMatchObject({
      displayName: ["Informe o nome de exibição."],
      instagramHandle: ["Use só letras, números, ponto e sublinhado (até 30)."],
    });
  });
});
```

In `src/app/api/id-guard.test.ts`, add `import { CreatorNotFoundError } from "@/domain/creators/errors";` and this row to `cases`:

```typescript
  { route: "creators/[id]", load: () => import("./creators/[id]/route"), methods: ["PATCH"], error: new CreatorNotFoundError(BAD).message },
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/creators src/services/creator.service.test.ts src/app/api/creators src/app/api/id-guard.test.ts`
Expected: FAIL (modules and methods missing).

- [ ] **Step 3: Implement**

```typescript
// src/lib/creators/creator-input.ts
import { z } from "zod";

const HANDLE_MESSAGE = "Use só letras, números, ponto e sublinhado (até 30).";
const HANDLE_PATTERN = /^[A-Za-z0-9._]{1,30}$/;

const instagramHandle = z
  .string()
  .nullish()
  .transform((value) => (value ?? "").trim().replace(/^@+/, "").trim())
  .refine((value) => value === "" || HANDLE_PATTERN.test(value), { message: HANDLE_MESSAGE })
  .transform((value) => (value === "" ? null : `@${value}`));

const displayName = z
  .string()
  .trim()
  .min(1, "Informe o nome de exibição.")
  .max(80, "Use no máximo 80 caracteres.");

export const createCreatorSchema = z.object({
  fullName: z.string().trim().min(1, "Informe o nome completo.").max(120, "Use no máximo 120 caracteres."),
  displayName,
  instagramHandle,
  email: z.string().trim().toLowerCase().pipe(z.email({ error: "Informe um e-mail válido." }).max(254, "Informe um e-mail válido.")),
});

export const updateCreatorSchema = z.object({ displayName, instagramHandle });

export type CreateCreatorInput = z.output<typeof createCreatorSchema>;
export type UpdateCreatorInput = z.output<typeof updateCreatorSchema>;
```

(If zod 4's `.toLowerCase()` or `.pipe` API differs in the installed version, use the equivalent. The tests are the contract.)

Append to `src/domain/creators/errors.ts`:

```typescript
export class CreatorEmailTakenError extends Error {
  constructor() {
    super("Já existe um creator com este e-mail.");
    this.name = "CreatorEmailTakenError";
  }
}
```

Add to `CreatorsRepository` (also import `users` from `@/db/schema/organizations`):

```typescript
export type CreatorWithEmail = Creator & { email: string };

  async findByUserIdWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, userId: string): Promise<Creator | null> {
    const [row] = await tx
      .select()
      .from(creators)
      .where(and(eq(creators.userId, userId), eq(creators.organizationId, organizationId)));
    return row ?? null;
  },

  async updateWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    input: { displayName: string; instagramHandle: string | null },
  ): Promise<Creator | null> {
    const [row] = await tx
      .update(creators)
      .set({ displayName: input.displayName, instagramHandle: input.instagramHandle })
      .where(and(eq(creators.id, creatorId), eq(creators.organizationId, organizationId)))
      .returning();
    return row ?? null;
  },

  async listWithEmailByOrganization(db: NodePgDatabase<typeof schema>, organizationId: string): Promise<CreatorWithEmail[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const rows = await tx
        .select({ creator: creators, email: users.email })
        .from(creators)
        .innerJoin(users, eq(users.id, creators.userId))
        .where(eq(creators.organizationId, organizationId))
        .orderBy(asc(creators.displayName));
      return rows.map((row) => ({ ...row.creator, email: row.email }));
    });
  },
```

Add to `CreatorService` (imports: `UsersRepository`, `CreatorEmailTakenError`, `CreateCreatorInput`/`UpdateCreatorInput` from `@/lib/creators/creator-input`, `CreatorWithEmail`):

```typescript
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === "23505";
}

  /**
   * Creates the creator, reusing the global `users` row when the e-mail already exists
   * (e.g. the owner registering their own creator profile). Never grants access:
   * no organization_members row is created here.
   */
  async register(db: NodePgDatabase<typeof schema>, organizationId: string, input: CreateCreatorInput): Promise<Creator> {
    try {
      return await runInTenantContext(db, organizationId, async (tx) => {
        const existing = await UsersRepository.findByEmail(tx, input.email);
        let userId: string;
        if (existing) {
          if (await CreatorsRepository.findByUserIdWithTx(tx, organizationId, existing.id)) {
            throw new CreatorEmailTakenError();
          }
          userId = existing.id;
        } else {
          const [user] = await tx.insert(users).values({ email: input.email, fullName: input.fullName }).returning();
          userId = user.id;
        }
        return CreatorsRepository.createWithTx(tx, organizationId, {
          userId,
          displayName: input.displayName,
          instagramHandle: input.instagramHandle,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new CreatorEmailTakenError();
      throw error;
    }
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    input: UpdateCreatorInput,
  ): Promise<Creator | null> {
    return runInTenantContext(db, organizationId, (tx) => CreatorsRepository.updateWithTx(tx, organizationId, creatorId, input));
  },

  async listWithEmail(db: NodePgDatabase<typeof schema>, organizationId: string): Promise<CreatorWithEmail[]> {
    return CreatorsRepository.listWithEmailByOrganization(db, organizationId);
  },
```

Add to `src/lib/auth/http.ts`:

```typescript
import type { SessionRole } from "./types";

export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
}

/** Creators are managed by the agency side only. */
export function canManageCreators(role: SessionRole): boolean {
  return role === "OWNER" || role === "MANAGER";
}
```

`src/app/api/creators/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CreatorService } from "@/services/creator.service";
import { getSession } from "@/lib/auth/session";
import { canManageCreators, forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { createCreatorSchema } from "@/lib/creators/creator-input";
import { CreatorEmailTakenError } from "@/domain/creators/errors";

export async function GET(_request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const list = await CreatorService.listWithEmail(db, session.organizationId);
  return NextResponse.json(list, { status: 200 });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();
  if (!canManageCreators(session.role)) return forbiddenResponse();

  const parsed = createCreatorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  try {
    const creator = await CreatorService.register(db, session.organizationId, parsed.data);
    return NextResponse.json(creator, { status: 201 });
  } catch (error) {
    if (error instanceof CreatorEmailTakenError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
```

`src/app/api/creators/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CreatorService } from "@/services/creator.service";
import { getSession } from "@/lib/auth/session";
import { canManageCreators, forbiddenResponse, unauthorizedResponse } from "@/lib/auth/http";
import { updateCreatorSchema } from "@/lib/creators/creator-input";
import { CreatorNotFoundError } from "@/domain/creators/errors";
import { isUuid } from "@/lib/uuid";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const notFound = () => NextResponse.json({ error: new CreatorNotFoundError(id).message }, { status: 404 });
  if (!isUuid(id)) return notFound();
  if (!canManageCreators(session.role)) return forbiddenResponse();

  const parsed = updateCreatorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  }

  const creator = await CreatorService.update(db, session.organizationId, id, parsed.data);
  if (!creator) return notFound();
  return NextResponse.json(creator, { status: 200 });
}
```

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/lib/creators src/services/creator.service.test.ts src/app/api/creators src/app/api/id-guard.test.ts
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/lib/creators src/lib/auth/http.ts src/domain/creators src/repositories/creators.repository.ts src/services/creator.service.ts src/services/creator.service.test.ts src/app/api/creators src/app/api/id-guard.test.ts
git commit -m "feat: register and edit creators through the API"
```

---

### Task 2: Client data layer — `ApiError` body and creator hooks

**Files:**
- Modify: `src/lib/api-client.ts`, `src/lib/api-client.test.ts`
- Create: `src/hooks/use-creators.ts`, `src/hooks/use-creators.test.tsx`

**Interfaces:**
- Consumes: the Task 1 HTTP contract.
- Produces:
  - `ApiError` gains `readonly body: unknown` (the parsed JSON error body, or `null`), set by `apiFetch`;
  - `export interface CreatorDto { id: string; displayName: string; instagramHandle: string | null; email: string; createdAt: string; userId: string; organizationId: string }`;
  - `export interface CreatorFormValues { fullName: string; displayName: string; instagramHandle: string; email: string }`;
  - `creatorsQueryKey = ["creators"] as const`;
  - `useCreators()`;
  - `useCreateCreator()` (mutation posting `CreatorFormValues`, returns `CreatorDto`);
  - `useUpdateCreator(creatorId: string)` (mutation posting `{ displayName; instagramHandle }`);
  - both mutations invalidate `creatorsQueryKey` on settle.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/api-client.test.ts`:

```typescript
  it("keeps the parsed error body on ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: { email: ["Informe um e-mail válido."] } }), { status: 400 }),
    );
    const error = await apiFetch("/x").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.body).toEqual({ errors: { email: ["Informe um e-mail válido."] } });
  });
```

(Import `vi` and `ApiError` if the file doesn't already.)

```tsx
// src/hooks/use-creators.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { creatorsQueryKey, useCreateCreator, useCreators, useUpdateCreator } from "./use-creators";

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("creator hooks", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists creators", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{ id: "c1", displayName: "Thais" }]), { status: 200 }));
    const client = new QueryClient();
    const { result } = renderHook(() => useCreators(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: "c1", displayName: "Thais" }]));
  });

  it("creates and invalidates the list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "c1" }), { status: 201 }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateCreator(), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ fullName: "Thais", displayName: "Thais", instagramHandle: "", email: "t@x.com" });
    expect(fetchMock).toHaveBeenCalledWith("/api/creators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: "Thais", displayName: "Thais", instagramHandle: "", email: "t@x.com" }),
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: creatorsQueryKey }));
  });

  it("updates by id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "c1" }), { status: 200 }));
    const client = new QueryClient();
    const { result } = renderHook(() => useUpdateCreator("c1"), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ displayName: "T", instagramHandle: "" });
    expect(fetchMock).toHaveBeenCalledWith("/api/creators/c1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "T", instagramHandle: "" }),
    });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/api-client.test.ts src/hooks/use-creators.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/lib/api-client.ts`, give `ApiError` a third constructor parameter `readonly body: unknown = null` (keep `status` and `message`). In `apiFetch`, keep the parsed JSON in a variable (`let body: unknown = null;`), assign it inside the existing `try`, and pass it: `throw new ApiError(response.status, message, body);`.

```typescript
// src/hooks/use-creators.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface CreatorDto {
  id: string;
  organizationId: string;
  userId: string;
  displayName: string;
  instagramHandle: string | null;
  email: string;
  createdAt: string;
}

export interface CreatorFormValues {
  fullName: string;
  displayName: string;
  instagramHandle: string;
  email: string;
}

export const creatorsQueryKey = ["creators"] as const;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function useCreators() {
  return useQuery({ queryKey: creatorsQueryKey, queryFn: () => apiFetch<CreatorDto[]>("/api/creators") });
}

export function useCreateCreator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CreatorFormValues) => apiFetch<CreatorDto>("/api/creators", json("POST", values)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: creatorsQueryKey }),
  });
}

export function useUpdateCreator(creatorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { displayName: string; instagramHandle: string }) =>
      apiFetch<CreatorDto>(`/api/creators/${creatorId}`, json("PATCH", values)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: creatorsQueryKey }),
  });
}
```

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/lib/api-client.test.ts src/hooks/use-creators.test.tsx
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/lib/api-client.ts src/lib/api-client.test.ts src/hooks/use-creators.ts src/hooks/use-creators.test.tsx
git commit -m "feat: creator data hooks and ApiError body"
```

---

### Task 3: `/creators` page, dialog, sidebar and switcher link

**Files:**
- Create: `src/components/creators/creator-form-dialog.tsx`, `src/components/creators/creator-form-dialog.test.tsx`, `src/app/(app)/creators/page.tsx`, `src/app/(app)/creators/page.test.tsx`
- Modify: `src/components/shell/sidebar.tsx`, `src/components/shell/creator-switcher.tsx`, and their tests (`sidebar.test.tsx` and `creator-switcher.test.tsx`, if present; create the switcher test if missing)

**Interfaces:**
- Consumes: `useCreators`, `useCreateCreator`, `useUpdateCreator`, `CreatorDto`, `CreatorFormValues`, `ApiError` with `.body` (Task 2); `useCreatorContext()` (`creators`, `selectedCreatorId`, `selectCreator`) from `@/components/shell/creator-context`; `EmptyState`; `Table*`; `Dialog*`; `Button`; `Input`; `formatDateTime` or the date formatter used elsewhere (read `src/lib/format.ts` and use its date-only formatter if one exists); `useRouter` from `next/navigation`; `toast` from `sonner`.
- Produces: `CreatorFormDialog({ open, creator, onOpenChange, onSaved }: { open: boolean; creator: CreatorDto | null; onOpenChange: (open: boolean) => void; onSaved: (creator: CreatorDto, mode: "create" | "edit") => void })`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/creators/creator-form-dialog.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const createMock = vi.fn();
const updateMock = vi.fn();
vi.mock("@/hooks/use-creators", () => ({
  useCreateCreator: () => ({ mutateAsync: createMock, isPending: false }),
  useUpdateCreator: () => ({ mutateAsync: updateMock, isPending: false }),
}));

import { CreatorFormDialog } from "./creator-form-dialog";

const existing = {
  id: "c1",
  organizationId: "o1",
  userId: "u1",
  displayName: "Thais",
  instagramHandle: "@thais",
  email: "thais@x.com",
  createdAt: "2026-09-28T12:00:00.000Z",
};

describe("CreatorFormDialog", () => {
  beforeEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
  });

  it("create: display name follows the full name until edited, then submits", async () => {
    const onSaved = vi.fn();
    createMock.mockResolvedValue({ ...existing, id: "c2" });
    render(<CreatorFormDialog open creator={null} onOpenChange={() => {}} onSaved={onSaved} />);

    expect(screen.getByRole("heading", { name: "Novo creator" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nome completo"), "Thais Rocha");
    expect(screen.getByLabelText("Nome de exibição")).toHaveValue("Thais Rocha");
    await userEvent.clear(screen.getByLabelText("Nome de exibição"));
    await userEvent.type(screen.getByLabelText("Nome de exibição"), "Thais");
    await userEvent.type(screen.getByLabelText("Nome completo"), " S");
    expect(screen.getByLabelText("Nome de exibição")).toHaveValue("Thais");
    await userEvent.type(screen.getByLabelText("@Instagram"), "thais");
    await userEvent.type(screen.getByLabelText("E-mail"), "thais@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar" }));

    expect(createMock).toHaveBeenCalledWith({ fullName: "Thais Rocha S", displayName: "Thais", instagramHandle: "thais", email: "thais@x.com" });
    expect(onSaved).toHaveBeenCalledWith({ ...existing, id: "c2" }, "create");
  });

  it("shows server field errors, including the 409 under E-mail", async () => {
    createMock.mockRejectedValueOnce(new ApiError(409, "Já existe um creator com este e-mail.", { error: "Já existe um creator com este e-mail." }));
    render(<CreatorFormDialog open creator={null} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText("Nome completo"), "Thais");
    await userEvent.type(screen.getByLabelText("E-mail"), "thais@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar" }));

    expect(await screen.findByText("Já existe um creator com este e-mail.")).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("aria-invalid", "true");

    createMock.mockRejectedValueOnce(new ApiError(400, "Bad Request", { errors: { instagramHandle: ["Use só letras, números, ponto e sublinhado (até 30)."] } }));
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar" }));
    expect(await screen.findByText("Use só letras, números, ponto e sublinhado (até 30).")).toBeInTheDocument();
    expect(screen.getByLabelText("@Instagram")).toHaveAccessibleDescription("Use só letras, números, ponto e sublinhado (até 30).");
  });

  it("edit: e-mail disabled, only display fields sent", async () => {
    const onSaved = vi.fn();
    updateMock.mockResolvedValue({ ...existing, displayName: "Thais R." });
    render(<CreatorFormDialog open creator={existing} onOpenChange={() => {}} onSaved={onSaved} />);

    expect(screen.getByRole("heading", { name: "Editar creator" })).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toBeDisabled();
    expect(screen.getByLabelText("E-mail")).toHaveValue("thais@x.com");
    expect(screen.queryByLabelText("Nome completo")).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Nome de exibição"));
    await userEvent.type(screen.getByLabelText("Nome de exibição"), "Thais R.");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(updateMock).toHaveBeenCalledWith({ displayName: "Thais R.", instagramHandle: "@thais" });
    expect(onSaved).toHaveBeenCalledWith({ ...existing, displayName: "Thais R." }, "edit");
  });
});
```

The full name only exists for the new `users` row, so it isn't shown when editing. The creator row has no full name.

```tsx
// src/app/(app)/creators/page.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let list: unknown[] | undefined;
const refreshMock = vi.fn();
const selectCreator = vi.fn();
let selectedCreatorId: string | null = null;
const toastSuccess = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock("@/components/shell/creator-context", () => ({
  useCreatorContext: () => ({ creators: [], selectedCreatorId, selectCreator }),
}));
vi.mock("@/hooks/use-creators", () => ({ useCreators: () => ({ data: list, isLoading: false }) }));
let savedCreator: unknown;
vi.mock("@/components/creators/creator-form-dialog", () => ({
  CreatorFormDialog: ({ open, creator, onSaved }: { open: boolean; creator: unknown; onSaved: (c: unknown, m: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onSaved(savedCreator, creator ? "edit" : "create")}>
        fake-save
      </button>
    ) : null,
}));

import CreatorsPage from "./page";

const thais = { id: "c1", displayName: "Thais", instagramHandle: "@thais", email: "thais@x.com", createdAt: "2026-09-28T12:00:00.000Z" };

describe("CreatorsPage", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    selectCreator.mockReset();
    toastSuccess.mockReset();
    selectedCreatorId = null;
  });

  it("empty state offers Novo creator", () => {
    list = [];
    render(<CreatorsPage />);
    expect(screen.getByText("Nenhum creator cadastrado")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Novo creator" }).length).toBeGreaterThan(0);
  });

  it("lists creators with their columns", () => {
    list = [thais];
    render(<CreatorsPage />);
    for (const header of ["Nome de exibição", "@Instagram", "E-mail", "Cadastrado em"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    expect(screen.getByRole("cell", { name: "Thais" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "thais@x.com" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });

  it("after creating: toast, refresh, and selects the new creator when none was selected", async () => {
    list = [];
    savedCreator = { ...thais, id: "c9" };
    render(<CreatorsPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Novo creator" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "fake-save" }));
    expect(toastSuccess).toHaveBeenCalledWith("Creator cadastrado.");
    expect(refreshMock).toHaveBeenCalled();
    expect(selectCreator).toHaveBeenCalledWith("c9");
  });

  it("after editing: toast and refresh, no re-selection", async () => {
    list = [thais];
    selectedCreatorId = "c1";
    savedCreator = thais;
    render(<CreatorsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    await userEvent.click(screen.getByRole("button", { name: "fake-save" }));
    expect(toastSuccess).toHaveBeenCalledWith("Creator atualizado.");
    expect(refreshMock).toHaveBeenCalled();
    expect(selectCreator).not.toHaveBeenCalled();
  });
});
```

Sidebar and switcher tests:
- In the sidebar test (it iterates the nav items), make sure a `Creators` link to `/creators` is expected.
- For the switcher, create or extend `src/components/shell/creator-switcher.test.tsx`: with `creators: []`, `screen.getByRole("link", { name: "Cadastrar creator" })` has `href="/creators"`. Mock `./creator-context` as other shell tests do.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/components/creators "src/app/(app)/creators" src/components/shell`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/creators/creator-form-dialog.tsx
"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { useCreateCreator, useUpdateCreator, type CreatorDto } from "@/hooks/use-creators";

type Field = "fullName" | "displayName" | "instagramHandle" | "email";
type FieldErrors = Partial<Record<Field, string>>;

function toFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiError)) return { email: "Não foi possível salvar. Tente novamente." };
  if (error.status === 409) return { email: error.message };
  const errors = (error.body as { errors?: Partial<Record<Field, string[]>> } | null)?.errors ?? {};
  const result: FieldErrors = {};
  for (const field of ["fullName", "displayName", "instagramHandle", "email"] as const) {
    const first = errors[field]?.[0];
    if (first) result[field] = first;
  }
  return Object.keys(result).length > 0 ? result : { email: "Não foi possível salvar. Tente novamente." };
}

export function CreatorFormDialog({
  open,
  creator,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  creator: CreatorDto | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (creator: CreatorDto, mode: "create" | "edit") => void;
}) {
  const editing = creator !== null;
  const create = useCreateCreator();
  const update = useUpdateCreator(creator?.id ?? "");
  const [fullName, setFullName] = React.useState("");
  const [displayName, setDisplayName] = React.useState(creator?.displayName ?? "");
  const [displayNameTouched, setDisplayNameTouched] = React.useState(editing);
  const [instagramHandle, setInstagramHandle] = React.useState(creator?.instagramHandle ?? "");
  const [email, setEmail] = React.useState(creator?.email ?? "");
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const pending = create.isPending || update.isPending;

  function field(name: Field, label: string, value: string, onChange: (value: string) => void, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) {
    const errorId = `creator-${name}-error`;
    return (
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-sm">
          {label}
          <Input
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setErrors(({ [name]: _removed, ...rest }) => rest);
            }}
            aria-invalid={errors[name] ? true : undefined}
            aria-describedby={errors[name] ? errorId : undefined}
            {...extra}
          />
        </label>
        {errors[name] ? (
          <p id={errorId} className="text-xs text-error">
            {errors[name]}
          </p>
        ) : null}
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      const saved = editing
        ? await update.mutateAsync({ displayName, instagramHandle })
        : await create.mutateAsync({ fullName, displayName, instagramHandle, email });
      onSaved(saved, editing ? "edit" : "create");
    } catch (error) {
      setErrors(toFieldErrors(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar creator" : "Novo creator"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {editing
            ? null
            : field("fullName", "Nome completo", fullName, (value) => {
                setFullName(value);
                if (!displayNameTouched) setDisplayName(value);
              }, { maxLength: 120, autoComplete: "name" })}
          {field("displayName", "Nome de exibição", displayName, (value) => {
            setDisplayName(value);
            setDisplayNameTouched(true);
          }, { maxLength: 80 })}
          {field("instagramHandle", "@Instagram", instagramHandle, setInstagramHandle, { maxLength: 31 })}
          {field("email", "E-mail", email, setEmail, { type: "email", maxLength: 254, disabled: editing })}
          <Button type="submit" disabled={pending}>
            {editing ? "Salvar" : "Cadastrar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

The dialog is mounted fresh each time it opens: the page renders it with a `key`, so its state resets per open.

```tsx
// src/app/(app)/creators/page.tsx
"use client";

import * as React from "react";
import { Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCreatorContext } from "@/components/shell/creator-context";
import { CreatorFormDialog } from "@/components/creators/creator-form-dialog";
import { useCreators, type CreatorDto } from "@/hooks/use-creators";

const dateLabel = (iso: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));

export default function CreatorsPage() {
  const router = useRouter();
  const { selectedCreatorId, selectCreator } = useCreatorContext();
  const { data: creators, isLoading } = useCreators();
  const [dialog, setDialog] = React.useState<{ open: boolean; creator: CreatorDto | null; key: number }>({
    open: false,
    creator: null,
    key: 0,
  });

  const openDialog = (creator: CreatorDto | null) => setDialog((prev) => ({ open: true, creator, key: prev.key + 1 }));

  function onSaved(creator: CreatorDto, mode: "create" | "edit") {
    setDialog((prev) => ({ ...prev, open: false }));
    toast.success(mode === "create" ? "Creator cadastrado." : "Creator atualizado.");
    router.refresh();
    if (mode === "create" && selectedCreatorId === null) selectCreator(creator.id);
  }

  const newButton = (
    <Button type="button" onClick={() => openDialog(null)}>
      Novo creator
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Creators</h1>
        {creators && creators.length > 0 ? newButton : null}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : !creators || creators.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum creator cadastrado" action={newButton} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome de exibição</TableHead>
              <TableHead>@Instagram</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Cadastrado em</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {creators.map((creator) => (
              <TableRow key={creator.id}>
                <TableCell>{creator.displayName}</TableCell>
                <TableCell>{creator.instagramHandle ?? "—"}</TableCell>
                <TableCell>{creator.email}</TableCell>
                <TableCell>{dateLabel(creator.createdAt)}</TableCell>
                <TableCell>
                  <Button type="button" variant="outline" size="sm" onClick={() => openDialog(creator)}>
                    Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <CreatorFormDialog
        key={dialog.key}
        open={dialog.open}
        creator={dialog.creator}
        onOpenChange={(open) => setDialog((prev) => ({ ...prev, open }))}
        onSaved={onSaved}
      />
    </div>
  );
}
```

Sidebar (`src/components/shell/sidebar.tsx`): add `Users` to the `lucide-react` import and `{ label: "Creators", href: "/creators", icon: Users },` between Pipeline and Proposals.

Switcher (`src/components/shell/creator-switcher.tsx`): replace the empty-state `<span>` with:

```tsx
    return (
      <Link href="/creators" className="text-sm text-primary underline-offset-4 hover:underline">
        Cadastrar creator
      </Link>
    );
```

and import `Link from "next/link"`.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/components/creators "src/app/(app)/creators" src/components/shell
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add src/components/creators "src/app/(app)/creators" src/components/shell
git commit -m "feat: creators page with create and edit dialog"
```

---

## Visual verification (controller, after Task 3, before the final review)

In the browser pane, on the worktree dev server (port 3001), with the user logged in on the local dev DB:
1. The dev DB was recreated empty. Provision the user as OWNER first with `scripts/provision-user.ts` against the dev DB (the controller does it).
2. The empty switcher shows "Cadastrar creator", which goes to `/creators`.
3. Create a creator. Check the toast, the list row, and that the switcher shows and selects it.
4. Edit it and check that the e-mail is disabled.
5. Try to create it again with the same e-mail: the 409 appears under E-mail.

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3 rules: validation, reuse, 409 including the race, update fields, 403, order, list with e-mail | 1 |
| §3 400 shape | 1 |
| §4 page, dialog, pre-fill, e-mail disabled, field errors, toast, refresh, select-new | 3 (with data hooks in 2) |
| §4 sidebar and switcher | 3 |
| §5 tests | 1–3 |
| §6 no migration | — |

**Placeholder scan:** no TBDs. One adaptation is flagged: the zod `.toLowerCase()`/`.pipe` API in the installed version.

**Type consistency:**

| Name | Defined in | Used in |
|---|---|---|
| `CreateCreatorInput`, `UpdateCreatorInput` | Task 1 | the service |
| `CreatorDto`, `CreatorFormValues`, the hooks, `ApiError.body` | Task 2 | Task 3 |
| `CreatorFormDialog` props | Task 3 | Task 3's page |
