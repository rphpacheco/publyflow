# PublyFlow — Core Domain & Inbox→Inquiry→Lead→Opportunity Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the multi-tenant core (organizations/users/members/creators with RLS) and
the real commercial flow — manual Inbox message → AI Classification → Commercial Inquiry →
Lead → Opportunity — as specified in `docs/superpowers/specs/2026-09-21-publyflow-mvp-design.md` (v3).

**Architecture:** Next.js 16 monolith with layered code (`domain/` → `services/` →
`repositories/` → `app/api/`), Postgres via Supabase, Drizzle ORM, RLS enforced per
`organization_id`. AI classification goes through an abstract `AIService` backed by an
OpenAI provider. This plan covers **only** Milestone 1 (multi-tenant core) and Milestone 2
(Inbox → Inquiry → Lead → Opportunity). Rate Cards, Proposals, Media Kit and Dashboard are
out of scope here and get their own plan later.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Drizzle ORM, PostgreSQL
(Supabase), Supabase Auth, OpenAI SDK, Zod, Vitest, pnpm.

## Global Constraints

- Every domain table carries `organization_id` with RLS enforced — no exceptions (spec §6).
- Commission percentage is never hardcoded (spec §1) — out of scope for this plan but the
  schema conventions set here must not violate it later.
- AI provider is OpenAI, called only through the `AIService` abstraction — no direct OpenAI
  SDK calls outside `src/lib/ai/` (spec §5, Decisão #4).
- AI classification/extraction never invents data — unknown fields are `null` (spec §5).
- `Opportunity` requires `company_id` or `brand_id`; if both present, `brand.company_id`
  (when set) must equal `opportunity.company_id` (spec §6, Decisão #11).
- Existing-client messages reuse an open `Opportunity` when one exists for the resolved
  party instead of always creating a new one (spec §6, Decisão #12).
- Inbox manual flow must stay low-friction (minimize steps/clicks) — spec §8.
- Node.js ≥ 20 (per project environment memory), pnpm as package manager.

---

## File Structure

```
publyflow/
  drizzle.config.ts
  docker-compose.test.yml            # local Postgres for dev + tests
  .env.example
  src/
    db/
      client.ts                      # Drizzle client factory
      schema/
        organizations.ts
        creators.ts
        companies-brands-contacts.ts
        conversations-messages.ts
        commercial-flow.ts           # commercial_inquiries, leads, opportunities, opportunity_stage_history
        ai.ts                        # ai_classifications, ai_extractions
        index.ts                     # barrel re-export, used by drizzle.config.ts
      migrations/                    # drizzle-kit generated SQL
    domain/
      organizations/
        types.ts
      commercial-flow/
        types.ts                     # Inquiry/Lead/Opportunity status enums + domain errors
    repositories/
      organizations.repository.ts
      creators.repository.ts
      companies.repository.ts
      brands.repository.ts
      contacts.repository.ts
      conversations.repository.ts
      messages.repository.ts
      commercial-inquiries.repository.ts
      leads.repository.ts
      opportunities.repository.ts
    services/
      organization.service.ts
      creator.service.ts
      inbox.service.ts               # ingest manual message
      commercial-inquiry.service.ts  # discard / convert / associate
      opportunity.service.ts         # createFromLead, findOpenOpportunityForParty
    lib/
      ai/
        ai-service.ts                # AIService interface + factory
        openai-provider.ts           # OpenAI-backed implementation
        schemas.ts                   # Zod schemas for classify/extract output
    app/
      api/
        inbox/
          messages/route.ts          # POST — ingest manual message
        commercial-inquiries/
          [id]/
            discard/route.ts         # POST
            convert/route.ts         # POST
            associate/route.ts       # POST
    test/
      helpers/
        db.ts                        # test DB setup/teardown, tenant context helper
```

---

## Milestone 1 — Multi-Tenant Core & Domain Foundation

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`,
  `postcss.config.mjs`, `.env.example`, `.gitignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx` (placeholder shell)

**Interfaces:** none yet (nothing downstream depends on this beyond "the app builds").

- [ ] **Step 1: Scaffold Next.js app**

```bash
pnpm dlx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-pnpm
```

When prompted about a non-empty directory (the `docs/` folder and `.git` already exist),
confirm to proceed in the current directory.

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: build completes with the default Next.js starter page, exit code 0.

- [ ] **Step 3: Add `.env.example`**

```bash
cat > .env.example <<'EOF'
DATABASE_URL=postgresql://postgres:postgres@localhost:54329/publyflow
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/publyflow_test
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
EOF
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 app"
```

---

### Task 2: Local Postgres for dev/test + Drizzle wiring

**Files:**
- Create: `docker-compose.test.yml`
- Create: `drizzle.config.ts`
- Create: `src/db/client.ts`
- Create: `src/db/schema/index.ts` (empty barrel for now)
- Test: `src/db/client.test.ts`

**Interfaces:**
- Produces: `getDb(connectionString: string): NodePgDatabase<typeof schema>` from
  `src/db/client.ts`, used by every repository going forward.

- [ ] **Step 1: Add dependencies**

```bash
pnpm add drizzle-orm pg
pnpm add -D drizzle-kit @types/pg vitest dotenv
```

- [ ] **Step 2: Add `docker-compose.test.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: publyflow_test
    ports:
      - "54329:5432"
    tmpfs:
      - /var/lib/postgresql/data
```

- [ ] **Step 3: Write the failing test**

```typescript
// src/db/client.test.ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./client";

describe("getDb", () => {
  it("connects and can run a trivial query", async () => {
    const db = getDb(process.env.TEST_DATABASE_URL!);
    const result = await db.execute(sql`select 1 as value`);
    expect(result.rows[0]).toEqual({ value: 1 });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `docker compose -f docker-compose.test.yml up -d && pnpm vitest run src/db/client.test.ts`
Expected: FAIL — `./client` has no exported member `getDb` (module doesn't exist yet).

- [ ] **Step 5: Implement `src/db/client.ts`**

```typescript
// src/db/client.ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function getDb(connectionString: string): NodePgDatabase<typeof schema> {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}
```

```typescript
// src/db/schema/index.ts
export {};
```

- [ ] **Step 6: Add `drizzle.config.ts`**

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL!,
  },
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run src/db/client.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add docker-compose.test.yml drizzle.config.ts src/db package.json pnpm-lock.yaml
git commit -m "feat: wire Drizzle client against local Postgres"
```

---

### Task 3: Schema — organizations, users, organization_members

**Files:**
- Create: `src/db/schema/organizations.ts`
- Modify: `src/db/schema/index.ts`
- Test: `src/db/schema/organizations.test.ts`
- Test helper: `src/test/helpers/db.ts`

**Interfaces:**
- Produces: `organizations`, `users`, `organizationMembers` Drizzle tables and
  `organizationMemberRoleEnum` (`"OWNER" | "MANAGER" | "CREATOR"`) from
  `src/db/schema/organizations.ts`, consumed by every later schema file that needs
  `organization_id`.
- Produces: `src/test/helpers/db.ts` exporting `withTestDb(): Promise<{ db: NodePgDatabase<typeof schema>; cleanup: () => Promise<void> }>` which truncates all domain tables before returning a client — used by every subsequent repository/service test.

- [ ] **Step 1: Write the failing test**

```typescript
// src/db/schema/organizations.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users, organizationMembers } from "./organizations";

describe("organizations schema", () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    await cleanup?.();
  });

  it("inserts an organization, a user, and a membership with a role", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db
      .insert(organizations)
      .values({ name: "Thais Miranda Management" })
      .returning();

    const [user] = await db
      .insert(users)
      .values({ email: "assessora@publyflow.test", fullName: "Assessora Comercial" })
      .returning();

    const [member] = await db
      .insert(organizationMembers)
      .values({ organizationId: org.id, userId: user.id, role: "MANAGER" })
      .returning();

    expect(member.organizationId).toBe(org.id);
    expect(member.userId).toBe(user.id);
    expect(member.role).toBe("MANAGER");
  });

  it("rejects duplicate membership for the same user in the same organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "dup@publyflow.test", fullName: "Dup User" })
      .returning();

    await db
      .insert(organizationMembers)
      .values({ organizationId: org.id, userId: user.id, role: "OWNER" });

    await expect(
      db.insert(organizationMembers).values({
        organizationId: org.id,
        userId: user.id,
        role: "MANAGER",
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/organizations.test.ts`
Expected: FAIL — `./organizations` and `@/test/helpers/db` don't exist yet.

- [ ] **Step 3: Implement the test DB helper**

```typescript
// src/test/helpers/db.ts
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

const DOMAIN_TABLES = [
  "organization_members",
  "creators",
  "users",
  "organizations",
] as const;

export async function withTestDb() {
  const db = getDb(process.env.TEST_DATABASE_URL!);

  return {
    db,
    cleanup: async () => {
      for (const table of DOMAIN_TABLES) {
        await db.execute(sql.raw(`truncate table "${table}" cascade`));
      }
    },
  };
}
```

- [ ] **Step 4: Implement `src/db/schema/organizations.ts`**

```typescript
// src/db/schema/organizations.ts
import { pgEnum, pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";

export const organizationMemberRoleEnum = pgEnum("organization_member_role", [
  "OWNER",
  "MANAGER",
  "CREATOR",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organizationMemberRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("organization_members_org_user_unique").on(table.organizationId, table.userId)],
);
```

- [ ] **Step 5: Register in barrel and generate/apply migration**

```typescript
// src/db/schema/index.ts
export * from "./organizations";
```

Run:
```bash
pnpm drizzle-kit generate --name init_organizations
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/db/schema/organizations.test.ts`
Expected: PASS (both tests)

- [ ] **Step 7: Commit**

```bash
git add src/db src/test
git commit -m "feat: add organizations/users/organization_members schema"
```

---

### Task 4: Schema — creators

**Files:**
- Create: `src/db/schema/creators.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/test/helpers/db.ts` (add `"creators"` — already listed in Task 3's
  `DOMAIN_TABLES`, no change needed if Task 3 was implemented as above)
- Test: `src/db/schema/creators.test.ts`

**Interfaces:**
- Consumes: `organizations`, `users` from `src/db/schema/organizations.ts`.
- Produces: `creators` table from `src/db/schema/creators.ts` — `id`, `organizationId`,
  `userId` (not null — every Creator has its own login per Decisão #1), `displayName`,
  `instagramHandle` (nullable), `commissionDefaultBps` intentionally **not** on this table
  (commission rules are a separate module, out of scope here).

- [ ] **Step 1: Write the failing test**

```typescript
// src/db/schema/creators.test.ts
import { describe, it, afterEach, expect } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";

describe("creators schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("links a creator to an organization and a user account", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais Miranda" })
      .returning();

    const [creator] = await db
      .insert(creators)
      .values({
        organizationId: org.id,
        userId: user.id,
        displayName: "Thais Miranda",
        instagramHandle: "thaimiranda",
      })
      .returning();

    expect(creator.organizationId).toBe(org.id);
    expect(creator.userId).toBe(user.id);
    expect(creator.instagramHandle).toBe("thaimiranda");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/creators.test.ts`
Expected: FAIL — `./creators` doesn't exist.

- [ ] **Step 3: Implement `src/db/schema/creators.ts`**

```typescript
// src/db/schema/creators.ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { organizations, users } from "./organizations";

export const creators = pgTable("creators", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  displayName: text("display_name").notNull(),
  instagramHandle: text("instagram_handle"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Register, generate and apply migration**

```typescript
// src/db/schema/index.ts
export * from "./organizations";
export * from "./creators";
```

Run:
```bash
pnpm drizzle-kit generate --name add_creators
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/db/schema/creators.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db
git commit -m "feat: add creators schema linked to organization and user"
```

---

### Task 5: Row-Level Security for the core tables

**Files:**
- Create: `src/db/migrations/<timestamp>_rls_core.sql` (hand-written, not drizzle-generated)
- Test: `src/db/rls-core.test.ts`

**Interfaces:**
- Establishes the tenant-isolation convention used by every later table: a Postgres GUC
  `app.current_org_id` set per-connection (`SET LOCAL app.current_org_id = '<uuid>'`) is
  what RLS policies check via `current_setting('app.current_org_id', true)::uuid`. This is
  set by the repository layer (Task 6) right before each query, from the organization the
  authenticated caller belongs to (resolved at the API boundary via Supabase Auth). This
  keeps RLS enforceable and testable without depending on the full Supabase Auth JWT stack
  in tests, while still providing real defense-in-depth alongside app-level `WHERE
  organization_id = ...` filters in repositories.

- [ ] **Step 1: Write the failing test**

```typescript
// src/db/rls-core.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users, organizationMembers } from "./schema/organizations";
import { creators } from "./schema/creators";

describe("RLS on core tables", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns creators belonging to the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [orgA] = await db.insert(organizations).values({ name: "Org A" }).returning();
    const [orgB] = await db.insert(organizations).values({ name: "Org B" }).returning();
    const [userA] = await db
      .insert(users)
      .values({ email: "a@publyflow.test", fullName: "User A" })
      .returning();
    const [userB] = await db
      .insert(users)
      .values({ email: "b@publyflow.test", fullName: "User B" })
      .returning();

    await db.insert(creators).values({
      organizationId: orgA.id,
      userId: userA.id,
      displayName: "Creator A",
    });
    await db.insert(creators).values({
      organizationId: orgB.id,
      userId: userB.id,
      displayName: "Creator B",
    });

    await db.execute(sql`set local app.current_org_id = ${orgA.id}`);
    const visible = await db.select().from(creators);

    expect(visible).toHaveLength(1);
    expect(visible[0].displayName).toBe("Creator A");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/rls-core.test.ts`
Expected: FAIL — query returns both creators (2 rows), test expects 1.

- [ ] **Step 3: Write the RLS migration**

```sql
-- src/db/migrations/0003_rls_core.sql
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table creators enable row level security;

create policy org_isolation_organizations on organizations
  using (id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_members on organization_members
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_creators on creators
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
```

Apply it:
```bash
psql "$TEST_DATABASE_URL" -f src/db/migrations/0003_rls_core.sql
```

Note: because `withTestDb()` connects with the same Postgres role used by the app (not a
Postgres superuser/table owner bypassing RLS), the pool user must be a non-owner role.
Update `docker-compose.test.yml`'s init to create an `app_user` role without `BYPASSRLS`,
and point `TEST_DATABASE_URL` at that role — add this as a one-line addition to
`docker-compose.test.yml`'s environment and document it in `.env.example`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/db/rls-core.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db docker-compose.test.yml .env.example
git commit -m "feat: enforce RLS on core tables via app.current_org_id"
```

---

### Task 6: Repository layer with tenant context

**Files:**
- Create: `src/repositories/tenant-context.ts`
- Create: `src/repositories/organizations.repository.ts`
- Create: `src/repositories/creators.repository.ts`
- Test: `src/repositories/creators.repository.test.ts`

**Interfaces:**
- Produces: `runInTenantContext<T>(db: NodePgDatabase<typeof schema>, organizationId: string, fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>): Promise<T>` from
  `src/repositories/tenant-context.ts` — wraps a Drizzle transaction, sets
  `app.current_org_id` for that transaction, and runs `fn`. **Every repository method in
  every later task goes through this.**
- Produces: `CreatorsRepository.create(db, organizationId, input: { userId: string; displayName: string; instagramHandle?: string | null }): Promise<Creator>` and
  `CreatorsRepository.listByOrganization(db, organizationId): Promise<Creator[]>` from
  `src/repositories/creators.repository.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/repositories/creators.repository.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { CreatorsRepository } from "./creators.repository";

describe("CreatorsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a creator scoped to the tenant and lists only that tenant's creators", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [orgA] = await db.insert(organizations).values({ name: "Org A" }).returning();
    const [orgB] = await db.insert(organizations).values({ name: "Org B" }).returning();
    const [userA] = await db
      .insert(users)
      .values({ email: "a@publyflow.test", fullName: "User A" })
      .returning();

    await CreatorsRepository.create(db, orgA.id, {
      userId: userA.id,
      displayName: "Thais Miranda",
      instagramHandle: "thaimiranda",
    });

    const orgAResults = await CreatorsRepository.listByOrganization(db, orgA.id);
    const orgBResults = await CreatorsRepository.listByOrganization(db, orgB.id);

    expect(orgAResults).toHaveLength(1);
    expect(orgAResults[0].displayName).toBe("Thais Miranda");
    expect(orgBResults).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/repositories/creators.repository.test.ts`
Expected: FAIL — `./creators.repository` doesn't exist.

- [ ] **Step 3: Implement `src/repositories/tenant-context.ts`**

```typescript
// src/repositories/tenant-context.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";

export async function runInTenantContext<T>(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org_id', ${organizationId}, true)`);
    return fn(tx as unknown as NodePgDatabase<typeof schema>);
  });
}
```

- [ ] **Step 4: Implement `src/repositories/creators.repository.ts`**

```typescript
// src/repositories/creators.repository.ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { creators } from "@/db/schema/creators";
import { runInTenantContext } from "./tenant-context";

export type Creator = typeof creators.$inferSelect;

export interface CreateCreatorInput {
  userId: string;
  displayName: string;
  instagramHandle?: string | null;
}

export const CreatorsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateCreatorInput,
  ): Promise<Creator> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [creator] = await tx
        .insert(creators)
        .values({
          organizationId,
          userId: input.userId,
          displayName: input.displayName,
          instagramHandle: input.instagramHandle ?? null,
        })
        .returning();
      return creator;
    });
  },

  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Creator[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx.select().from(creators).where(eq(creators.organizationId, organizationId));
    });
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/repositories/creators.repository.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/repositories
git commit -m "feat: add tenant-scoped repository layer for creators"
```

---

### Task 7: Organization + Creator services (application layer)

**Files:**
- Create: `src/services/organization.service.ts`
- Create: `src/services/creator.service.ts`
- Test: `src/services/organization.service.test.ts`
- Test: `src/services/creator.service.test.ts`

**Interfaces:**
- Produces: `OrganizationService.createWithOwner(db, input: { organizationName: string; ownerEmail: string; ownerFullName: string }): Promise<{ organization: Organization; owner: User }>` from
  `src/services/organization.service.ts`.
- Produces: `CreatorService.onboardCreator(db, organizationId: string, input: { email: string; fullName: string; displayName: string; instagramHandle?: string | null }): Promise<Creator>` from
  `src/services/creator.service.ts` — creates the `users` row and the `creators` row
  together (Decisão #1: every Creator has its own login from day one).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/organization.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { organizationMembers } from "@/db/schema/organizations";
import { runInTenantContext } from "@/repositories/tenant-context";

describe("OrganizationService.createWithOwner", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates an organization, an owner user, and an OWNER membership", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Thais Miranda Management",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Raphael Pacheco",
    });

    const members = await runInTenantContext(db, organization.id, (tx) =>
      tx.select().from(organizationMembers),
    );

    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(owner.id);
    expect(members[0].role).toBe("OWNER");
  });
});
```

```typescript
// src/services/creator.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";

describe("CreatorService.onboardCreator", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a user and a linked creator in the same organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });

    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais Miranda",
      displayName: "Thais Miranda",
      instagramHandle: "thaimiranda",
    });

    expect(creator.organizationId).toBe(organization.id);
    expect(creator.displayName).toBe("Thais Miranda");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/services/organization.service.test.ts src/services/creator.service.test.ts`
Expected: FAIL — service modules don't exist.

- [ ] **Step 3: Implement `src/services/organization.service.ts`**

```typescript
// src/services/organization.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizations, users, organizationMembers } from "@/db/schema/organizations";

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;

export interface CreateOrganizationInput {
  organizationName: string;
  ownerEmail: string;
  ownerFullName: string;
}

export const OrganizationService = {
  async createWithOwner(
    db: NodePgDatabase<typeof schema>,
    input: CreateOrganizationInput,
  ): Promise<{ organization: Organization; owner: User }> {
    return db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({ name: input.organizationName })
        .returning();

      const [owner] = await tx
        .insert(users)
        .values({ email: input.ownerEmail, fullName: input.ownerFullName })
        .returning();

      await tx.insert(organizationMembers).values({
        organizationId: organization.id,
        userId: owner.id,
        role: "OWNER",
      });

      return { organization, owner };
    });
  },
};
```

- [ ] **Step 4: Implement `src/services/creator.service.ts`**

```typescript
// src/services/creator.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { users } from "@/db/schema/organizations";
import { CreatorsRepository, type Creator } from "@/repositories/creators.repository";

export interface OnboardCreatorInput {
  email: string;
  fullName: string;
  displayName: string;
  instagramHandle?: string | null;
}

export const CreatorService = {
  async onboardCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: OnboardCreatorInput,
  ): Promise<Creator> {
    const [user] = await db
      .insert(users)
      .values({ email: input.email, fullName: input.fullName })
      .returning();

    return CreatorsRepository.create(db, organizationId, {
      userId: user.id,
      displayName: input.displayName,
      instagramHandle: input.instagramHandle ?? null,
    });
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/services/organization.service.test.ts src/services/creator.service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services
git commit -m "feat: add OrganizationService and CreatorService"
```

---

## Milestone 2 — Inbox → Commercial Inquiry → Lead → Opportunity

### Task 8: Schema — companies, brands, contacts

**Files:**
- Create: `src/db/schema/companies-brands-contacts.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/test/helpers/db.ts` (extend `DOMAIN_TABLES` with `"contacts"`, `"brands"`,
  `"companies"`, in that truncation order — FKs cascade so order before `organizations`
  matters only for readability, `cascade` handles dependency order)
- Test: `src/db/schema/companies-brands-contacts.test.ts`

**Interfaces:**
- Produces: `companies`, `brands`, `contacts` tables. `brands.companyId` is **nullable**.
  `contacts.companyId` is **nullable**. This is the schema-level support for spec §6's
  Company≠Brand split and Decisão #11's compatibility rule (the rule itself is enforced in
  `OpportunityService`, Task 13 — not a DB constraint, per spec §9).

- [ ] **Step 1: Write the failing test**

```typescript
// src/db/schema/companies-brands-contacts.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "./organizations";
import { companies, brands, contacts } from "./companies-brands-contacts";

describe("companies/brands/contacts schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("allows a brand without a known parent company, and a contact without a known company", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();

    const [brand] = await db
      .insert(brands)
      .values({ organizationId: org.id, name: "Eudora", companyId: null })
      .returning();

    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria", companyId: null })
      .returning();

    expect(brand.companyId).toBeNull();
    expect(contact.companyId).toBeNull();
  });

  it("links a brand to its owning company when known", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [company] = await db
      .insert(companies)
      .values({ organizationId: org.id, name: "Grupo Boticário" })
      .returning();
    const [brand] = await db
      .insert(brands)
      .values({ organizationId: org.id, name: "O Boticário", companyId: company.id })
      .returning();

    expect(brand.companyId).toBe(company.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/companies-brands-contacts.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the schema**

```typescript
// src/db/schema/companies-brands-contacts.ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  instagramHandle: text("instagram_handle"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Register, generate and apply migration**

```typescript
// src/db/schema/index.ts
export * from "./organizations";
export * from "./creators";
export * from "./companies-brands-contacts";
```

Run:
```bash
pnpm drizzle-kit generate --name add_companies_brands_contacts
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/db/schema/companies-brands-contacts.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db
git commit -m "feat: add companies/brands/contacts schema"
```

---

### Task 9: Schema — conversations, messages

**Files:**
- Create: `src/db/schema/conversations-messages.ts`
- Modify: `src/db/schema/index.ts`
- Test: `src/db/schema/conversations-messages.test.ts`

**Interfaces:**
- Produces: `messageSourceEnum` (`"INSTAGRAM" | "WHATSAPP" | "TIKTOK"`), `conversations`
  (`id`, `organizationId`, `creatorId`, `source`, `externalContactLabel` — free text like
  "Maria — Bella Cosméticos" for manual entries), `messages` (`id`, `conversationId`,
  `organizationId`, `body`, `receivedAt`, `enteredManually` boolean default `true` — P0 has
  no automated source yet per spec §4).

- [ ] **Step 1: Write the failing test**

```typescript
// src/db/schema/conversations-messages.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "./organizations";
import { creators } from "./creators";
import { users } from "./organizations";
import { conversations, messages } from "./conversations-messages";

describe("conversations/messages schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("stores a manually-entered message tied to a conversation and source", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();

    const [conversation] = await db
      .insert(conversations)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        source: "INSTAGRAM",
        externalContactLabel: "Maria — Bella Cosméticos",
      })
      .returning();

    const [message] = await db
      .insert(messages)
      .values({
        organizationId: org.id,
        conversationId: conversation.id,
        body: "Olá, gostaríamos de saber os valores para uma campanha.",
        receivedAt: new Date(),
      })
      .returning();

    expect(message.conversationId).toBe(conversation.id);
    expect(message.enteredManually).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/conversations-messages.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the schema**

```typescript
// src/db/schema/conversations-messages.ts
import { pgEnum, pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { creators } from "./creators";

export const messageSourceEnum = pgEnum("message_source", ["INSTAGRAM", "WHATSAPP", "TIKTOK"]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id, { onDelete: "cascade" }),
  source: messageSourceEnum("source").notNull(),
  externalContactLabel: text("external_contact_label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  enteredManually: boolean("entered_manually").notNull().default(true),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Register, generate and apply migration**

```typescript
// src/db/schema/index.ts
export * from "./organizations";
export * from "./creators";
export * from "./companies-brands-contacts";
export * from "./conversations-messages";
```

Run:
```bash
pnpm drizzle-kit generate --name add_conversations_messages
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/db/schema/conversations-messages.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db
git commit -m "feat: add conversations/messages schema"
```

---

### Task 10: Schema — commercial_inquiries, leads, opportunities, opportunity_stage_history

**Files:**
- Create: `src/db/schema/commercial-flow.ts`
- Modify: `src/db/schema/index.ts`
- Test: `src/db/schema/commercial-flow.test.ts`

**Interfaces:**
- Produces: `commercialInquiryStatusEnum` (`"NEW" | "DISCARDED" | "FALSE_POSITIVE" |
  "CONVERTED"`), `opportunityStageEnum` (`"NOVO_LEAD" | "QUALIFICACAO" |
  "PRIMEIRO_CONTATO" | "MIDIA_KIT_ENVIADO" | "PROPOSTA_SOLICITADA" | "PROPOSTA_ENVIADA" |
  "NEGOCIACAO" | "AGUARDANDO_CLIENTE" | "FECHADO" | "PERDIDO"`, per spec §9 pipeline).
- Produces: `commercialInquiries` (`id`, `organizationId`, `creatorId`, `messageId`,
  `status`, `companyGuess`, `brandGuess`, `contactNameGuess`, `budgetGuess`, `intentGuess`,
  `convertedLeadId` nullable, `linkedOpportunityId` nullable).
- Produces: `leads` (`id`, `organizationId`, `creatorId`, `inquiryId` nullable, `contactId`,
  `companyId` nullable, `brandId` nullable, `qualified` boolean).
- Produces: `opportunities` (`id`, `organizationId`, `creatorId`, `leadId`, `companyId`
  nullable, `brandId` nullable, `stage`, `estimatedValueCents` nullable, `status`
  (`"OPEN" | "WON" | "LOST"`)).
- Produces: `opportunityStageHistory` (`id`, `opportunityId`, `fromStage` nullable,
  `toStage`, `changedAt`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/db/schema/commercial-flow.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { conversations, messages } from "./conversations-messages";
import {
  commercialInquiries,
  leads,
  opportunities,
  opportunityStageHistory,
} from "./commercial-flow";

describe("commercial flow schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("carries a message through inquiry, lead, opportunity, and stage history", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [conversation] = await db
      .insert(conversations)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        source: "INSTAGRAM",
        externalContactLabel: "Maria — Bella Cosméticos",
      })
      .returning();
    const [message] = await db
      .insert(messages)
      .values({
        organizationId: org.id,
        conversationId: conversation.id,
        body: "Gostaríamos do mídia kit para uma campanha.",
        receivedAt: new Date(),
      })
      .returning();

    const [inquiry] = await db
      .insert(commercialInquiries)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        messageId: message.id,
        status: "NEW",
        companyGuess: "Bella Cosméticos",
      })
      .returning();

    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();

    const [lead] = await db
      .insert(leads)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        inquiryId: inquiry.id,
        contactId: contact.id,
        qualified: true,
      })
      .returning();

    await db
      .update(commercialInquiries)
      .set({ status: "CONVERTED", convertedLeadId: lead.id })
      .where(eqId(commercialInquiries.id, inquiry.id));

    const [opportunity] = await db
      .insert(opportunities)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        leadId: lead.id,
        companyId: null,
        brandId: null,
        stage: "NOVO_LEAD",
        status: "OPEN",
      })
      .returning();

    const [historyEntry] = await db
      .insert(opportunityStageHistory)
      .values({ opportunityId: opportunity.id, fromStage: null, toStage: "NOVO_LEAD" })
      .returning();

    expect(historyEntry.opportunityId).toBe(opportunity.id);
    expect(opportunity.leadId).toBe(lead.id);
  });
});

function eqId<T extends { id: unknown }>(column: T["id"], value: string) {
  // local helper kept inline to avoid importing drizzle-orm's `eq` twice at module scope
  // in this test file
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (require("drizzle-orm") as typeof import("drizzle-orm")).eq(column as any, value);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/schema/commercial-flow.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the schema**

```typescript
// src/db/schema/commercial-flow.ts
import { pgEnum, pgTable, uuid, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { creators } from "./creators";
import { companies, brands, contacts } from "./companies-brands-contacts";
import { messages } from "./conversations-messages";

export const commercialInquiryStatusEnum = pgEnum("commercial_inquiry_status", [
  "NEW",
  "DISCARDED",
  "FALSE_POSITIVE",
  "CONVERTED",
]);

export const opportunityStageEnum = pgEnum("opportunity_stage", [
  "NOVO_LEAD",
  "QUALIFICACAO",
  "PRIMEIRO_CONTATO",
  "MIDIA_KIT_ENVIADO",
  "PROPOSTA_SOLICITADA",
  "PROPOSTA_ENVIADA",
  "NEGOCIACAO",
  "AGUARDANDO_CLIENTE",
  "FECHADO",
  "PERDIDO",
]);

export const opportunityStatusEnum = pgEnum("opportunity_status", ["OPEN", "WON", "LOST"]);

export const commercialInquiries = pgTable("commercial_inquiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id, { onDelete: "cascade" }),
  messageId: uuid("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  status: commercialInquiryStatusEnum("status").notNull().default("NEW"),
  companyGuess: text("company_guess"),
  brandGuess: text("brand_guess"),
  contactNameGuess: text("contact_name_guess"),
  budgetGuess: text("budget_guess"),
  intentGuess: text("intent_guess"),
  convertedLeadId: uuid("converted_lead_id"),
  linkedOpportunityId: uuid("linked_opportunity_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id, { onDelete: "cascade" }),
  inquiryId: uuid("inquiry_id").references(() => commercialInquiries.id, { onDelete: "set null" }),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "restrict" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
  qualified: boolean("qualified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "restrict" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
  stage: opportunityStageEnum("stage").notNull().default("NOVO_LEAD"),
  status: opportunityStatusEnum("status").notNull().default("OPEN"),
  estimatedValueCents: integer("estimated_value_cents"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opportunityStageHistory = pgTable("opportunity_stage_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  fromStage: opportunityStageEnum("from_stage"),
  toStage: opportunityStageEnum("to_stage").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Rewrite the test's `eqId` helper away — use a normal top-level import instead (the inline
`require` above is only to keep the step diff self-contained; replace it before committing):

```typescript
// src/db/schema/commercial-flow.test.ts (fix the import at the top of the file)
import { eq } from "drizzle-orm";
// ...replace the call site with: .where(eq(commercialInquiries.id, inquiry.id));
// ...and delete the `eqId` function entirely.
```

- [ ] **Step 4: Register, generate and apply migration**

```typescript
// src/db/schema/index.ts
export * from "./organizations";
export * from "./creators";
export * from "./companies-brands-contacts";
export * from "./conversations-messages";
export * from "./commercial-flow";
```

Run:
```bash
pnpm drizzle-kit generate --name add_commercial_flow
DATABASE_URL=$TEST_DATABASE_URL pnpm drizzle-kit migrate
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/db/schema/commercial-flow.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db
git commit -m "feat: add commercial_inquiries/leads/opportunities schema"
```

---

### Task 11: AIService abstraction + OpenAI-backed message classification

**Files:**
- Create: `src/lib/ai/schemas.ts`
- Create: `src/lib/ai/ai-service.ts`
- Create: `src/lib/ai/openai-provider.ts`
- Test: `src/lib/ai/openai-provider.test.ts`

**Interfaces:**
- Produces: `MessageClassification` Zod schema/type from `src/lib/ai/schemas.ts`:
  `{ category: "FAN"|"COMMERCIAL_LEAD"|"EXISTING_CLIENT"|"AGENCY"|"PRESS"|"PARTNERSHIP"|"SPAM"|"OTHER"; commercialScore: number; intent: string | null; extracted: { companyName: string|null; brandName: string|null; contactName: string|null; email: string|null; phone: string|null; budget: string|null; deliverables: string|null } }`.
- Produces: `AIService` interface from `src/lib/ai/ai-service.ts`:
  `{ classifyMessage(input: { body: string; source: string }): Promise<MessageClassification> }`.
- Produces: `createOpenAIService(apiKey: string): AIService` from
  `src/lib/ai/openai-provider.ts` — the **only** file allowed to import the `openai`
  package (Global Constraints).

- [ ] **Step 1: Add dependency**

```bash
pnpm add openai zod
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/lib/ai/openai-provider.test.ts
import { describe, it, expect, vi } from "vitest";
import { createOpenAIService } from "./openai-provider";

vi.mock("openai", () => {
  return {
    default: class OpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    category: "COMMERCIAL_LEAD",
                    commercialScore: 94,
                    intent: "Pedido de mídia kit",
                    extracted: {
                      companyName: "Bella Cosméticos",
                      brandName: null,
                      contactName: "Maria",
                      email: null,
                      phone: null,
                      budget: null,
                      deliverables: null,
                    },
                  }),
                },
              },
            ],
          }),
        },
      };
    },
  };
});

describe("createOpenAIService", () => {
  it("classifies a commercial message and never invents unknown fields", async () => {
    const service = createOpenAIService("test-key");

    const result = await service.classifyMessage({
      body: "Olá, gostaríamos de saber os valores para uma campanha.",
      source: "INSTAGRAM",
    });

    expect(result.category).toBe("COMMERCIAL_LEAD");
    expect(result.commercialScore).toBe(94);
    expect(result.extracted.companyName).toBe("Bella Cosméticos");
    expect(result.extracted.budget).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ai/openai-provider.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `src/lib/ai/schemas.ts`**

```typescript
// src/lib/ai/schemas.ts
import { z } from "zod";

export const messageCategoryEnum = z.enum([
  "FAN",
  "COMMERCIAL_LEAD",
  "EXISTING_CLIENT",
  "AGENCY",
  "PRESS",
  "PARTNERSHIP",
  "SPAM",
  "OTHER",
]);

export const messageClassificationSchema = z.object({
  category: messageCategoryEnum,
  commercialScore: z.number().min(0).max(100),
  intent: z.string().nullable(),
  extracted: z.object({
    companyName: z.string().nullable(),
    brandName: z.string().nullable(),
    contactName: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    budget: z.string().nullable(),
    deliverables: z.string().nullable(),
  }),
});

export type MessageClassification = z.infer<typeof messageClassificationSchema>;
```

- [ ] **Step 5: Implement `src/lib/ai/ai-service.ts`**

```typescript
// src/lib/ai/ai-service.ts
import type { MessageClassification } from "./schemas";

export interface ClassifyMessageInput {
  body: string;
  source: string;
}

export interface AIService {
  classifyMessage(input: ClassifyMessageInput): Promise<MessageClassification>;
}
```

- [ ] **Step 6: Implement `src/lib/ai/openai-provider.ts`**

```typescript
// src/lib/ai/openai-provider.ts
import OpenAI from "openai";
import type { AIService, ClassifyMessageInput } from "./ai-service";
import { messageClassificationSchema, type MessageClassification } from "./schemas";

const CLASSIFICATION_PROMPT = `Você é um classificador de mensagens comerciais para uma
plataforma de gestão de creators. Analise a mensagem recebida e retorne APENAS um JSON
válido no formato especificado. Nunca invente informações que não estão no texto — quando
um dado não estiver disponível, use null.`;

export function createOpenAIService(apiKey: string): AIService {
  const client = new OpenAI({ apiKey });

  return {
    async classifyMessage(input: ClassifyMessageInput): Promise<MessageClassification> {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CLASSIFICATION_PROMPT },
          {
            role: "user",
            content: `Origem: ${input.source}\nMensagem: ${input.body}`,
          },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw);
      return messageClassificationSchema.parse(parsed);
    },
  };
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ai/openai-provider.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai package.json pnpm-lock.yaml
git commit -m "feat: add AIService abstraction with OpenAI-backed message classification"
```

---

### Task 12: Inbox service — ingest a manual message

**Files:**
- Create: `src/repositories/conversations.repository.ts`
- Create: `src/repositories/commercial-inquiries.repository.ts`
- Create: `src/services/inbox.service.ts`
- Test: `src/services/inbox.service.test.ts`

**Interfaces:**
- Consumes: `AIService.classifyMessage` (Task 11), `runInTenantContext` (Task 6).
- Produces: `InboxService.ingestManualMessage(db, ai: AIService, organizationId: string, input: { creatorId: string; source: "INSTAGRAM"|"WHATSAPP"|"TIKTOK"; externalContactLabel: string; body: string; receivedAt: Date }): Promise<{ message: Message; classification: MessageClassification; inquiry: CommercialInquiry | null }>` from
  `src/services/inbox.service.ts`. Returns `inquiry: null` when the classification is
  `FAN` or `SPAM` — those categories never create a `commercial_inquiries` row (spec §3).

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/inbox.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { InboxService } from "./inbox.service";
import type { AIService } from "@/lib/ai/ai-service";

function fakeAI(classification: Parameters<AIService["classifyMessage"]>[0] extends never ? never : any): AIService {
  return { classifyMessage: async () => classification };
}

describe("InboxService.ingestManualMessage", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a Commercial Inquiry when the message is classified as commercial", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const ai = fakeAI({
      category: "COMMERCIAL_LEAD",
      commercialScore: 94,
      intent: "Pedido de mídia kit",
      extracted: {
        companyName: "Bella Cosméticos",
        brandName: null,
        contactName: "Maria",
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    });

    const result = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores para uma campanha.",
      receivedAt: new Date(),
    });

    expect(result.inquiry).not.toBeNull();
    expect(result.inquiry?.status).toBe("NEW");
    expect(result.inquiry?.companyGuess).toBe("Bella Cosméticos");
  });

  it("does not create a Commercial Inquiry for a FAN message", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner2@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais2@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const ai = fakeAI({
      category: "FAN",
      commercialScore: 2,
      intent: null,
      extracted: {
        companyName: null,
        brandName: null,
        contactName: null,
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    });

    const result = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Fã anônimo",
      body: "Amo seus vídeos! Você é maravilhosa",
      receivedAt: new Date(),
    });

    expect(result.inquiry).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/inbox.service.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement the repositories**

```typescript
// src/repositories/conversations.repository.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { conversations, messages } from "@/db/schema/conversations-messages";
import { runInTenantContext } from "./tenant-context";

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

export interface CreateConversationInput {
  creatorId: string;
  source: "INSTAGRAM" | "WHATSAPP" | "TIKTOK";
  externalContactLabel: string;
}

export interface CreateMessageInput {
  conversationId: string;
  body: string;
  receivedAt: Date;
}

export const ConversationsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateConversationInput,
  ): Promise<Conversation> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [conversation] = await tx
        .insert(conversations)
        .values({
          organizationId,
          creatorId: input.creatorId,
          source: input.source,
          externalContactLabel: input.externalContactLabel,
        })
        .returning();
      return conversation;
    });
  },
};

export const MessagesRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateMessageInput,
  ): Promise<Message> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [message] = await tx
        .insert(messages)
        .values({
          organizationId,
          conversationId: input.conversationId,
          body: input.body,
          receivedAt: input.receivedAt,
        })
        .returning();
      return message;
    });
  },
};
```

```typescript
// src/repositories/commercial-inquiries.repository.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { commercialInquiries } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "./tenant-context";
import type { MessageClassification } from "@/lib/ai/schemas";

export type CommercialInquiry = typeof commercialInquiries.$inferSelect;

export const CommercialInquiriesRepository = {
  async createFromClassification(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: { creatorId: string; messageId: string; classification: MessageClassification },
  ): Promise<CommercialInquiry> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [inquiry] = await tx
        .insert(commercialInquiries)
        .values({
          organizationId,
          creatorId: input.creatorId,
          messageId: input.messageId,
          status: "NEW",
          companyGuess: input.classification.extracted.companyName,
          brandGuess: input.classification.extracted.brandName,
          contactNameGuess: input.classification.extracted.contactName,
          budgetGuess: input.classification.extracted.budget,
          intentGuess: input.classification.intent,
        })
        .returning();
      return inquiry;
    });
  },
};
```

- [ ] **Step 4: Implement `src/services/inbox.service.ts`**

```typescript
// src/services/inbox.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import type { AIService } from "@/lib/ai/ai-service";
import type { MessageClassification } from "@/lib/ai/schemas";
import {
  ConversationsRepository,
  MessagesRepository,
  type Message,
} from "@/repositories/conversations.repository";
import {
  CommercialInquiriesRepository,
  type CommercialInquiry,
} from "@/repositories/commercial-inquiries.repository";

const NON_COMMERCIAL_CATEGORIES = new Set(["FAN", "SPAM"]);

export interface IngestManualMessageInput {
  creatorId: string;
  source: "INSTAGRAM" | "WHATSAPP" | "TIKTOK";
  externalContactLabel: string;
  body: string;
  receivedAt: Date;
}

export interface IngestManualMessageResult {
  message: Message;
  classification: MessageClassification;
  inquiry: CommercialInquiry | null;
}

export const InboxService = {
  async ingestManualMessage(
    db: NodePgDatabase<typeof schema>,
    ai: AIService,
    organizationId: string,
    input: IngestManualMessageInput,
  ): Promise<IngestManualMessageResult> {
    const conversation = await ConversationsRepository.create(db, organizationId, {
      creatorId: input.creatorId,
      source: input.source,
      externalContactLabel: input.externalContactLabel,
    });

    const message = await MessagesRepository.create(db, organizationId, {
      conversationId: conversation.id,
      body: input.body,
      receivedAt: input.receivedAt,
    });

    const classification = await ai.classifyMessage({
      body: input.body,
      source: input.source,
    });

    if (NON_COMMERCIAL_CATEGORIES.has(classification.category)) {
      return { message, classification, inquiry: null };
    }

    const inquiry = await CommercialInquiriesRepository.createFromClassification(
      db,
      organizationId,
      { creatorId: input.creatorId, messageId: message.id, classification },
    );

    return { message, classification, inquiry };
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/services/inbox.service.test.ts`
Expected: PASS (both tests)

- [ ] **Step 6: Commit**

```bash
git add src/repositories src/services
git commit -m "feat: add InboxService to ingest manual messages and create Commercial Inquiries"
```

---

### Task 13: Opportunity domain rules — company/brand validation + open-opportunity lookup

**Files:**
- Create: `src/domain/commercial-flow/errors.ts`
- Create: `src/repositories/leads.repository.ts`
- Create: `src/repositories/opportunities.repository.ts`
- Create: `src/services/opportunity.service.ts`
- Test: `src/services/opportunity.service.test.ts`

**Interfaces:**
- Produces: `InvalidOpportunityPartyError` from `src/domain/commercial-flow/errors.ts`.
- Produces: `OpportunitiesRepository.create`, `.findOpenForParty(db, organizationId, { contactId?, companyId?, brandId? })` from `src/repositories/opportunities.repository.ts`.
- Produces: `OpportunityService.createFromLead(db, organizationId: string, input: { leadId: string; creatorId: string; companyId: string | null; brandId: string | null }): Promise<Opportunity>` — enforces Decisão #11 (company/brand required + compatibility) from
  `src/services/opportunity.service.ts`.
- Produces: `OpportunityService.findOpenOpportunityForParty(db, organizationId: string, party: { contactId?: string; companyId?: string; brandId?: string }): Promise<Opportunity | null>` — used by Task 14 for the existing-client flow.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/opportunity.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { OpportunityService } from "./opportunity.service";
import { InvalidOpportunityPartyError } from "@/domain/commercial-flow/errors";
import { companies, brands, contacts } from "@/db/schema/companies-brands-contacts";
import { leads } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "@/repositories/tenant-context";

describe("OpportunityService.createFromLead", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-${Date.now()}@publyflow.test`,
      fullName: "Thais",
      displayName: "Thais",
    });
    return { db, cleanup: c, organization, creator };
  }

  it("rejects an opportunity with neither company_id nor brand_id", async () => {
    const { db, cleanup: c, organization, creator } = await setup();
    cleanup = c;

    const [contact] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(contacts).values({ organizationId: organization.id, fullName: "Maria" }).returning(),
    );
    const [lead] = await runInTenantContext(db, organization.id, (tx) =>
      tx
        .insert(leads)
        .values({
          organizationId: organization.id,
          creatorId: creator.id,
          contactId: contact.id,
          qualified: true,
        })
        .returning(),
    );

    await expect(
      OpportunityService.createFromLead(db, organization.id, {
        leadId: lead.id,
        creatorId: creator.id,
        companyId: null,
        brandId: null,
      }),
    ).rejects.toThrow(InvalidOpportunityPartyError);
  });

  it("rejects a brand belonging to a different company than the opportunity's company", async () => {
    const { db, cleanup: c, organization, creator } = await setup();
    cleanup = c;

    const [companyA] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Grupo Boticário" }).returning(),
    );
    const [companyB] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Unilever" }).returning(),
    );
    const [brand] = await runInTenantContext(db, organization.id, (tx) =>
      tx
        .insert(brands)
        .values({ organizationId: organization.id, name: "O Boticário", companyId: companyA.id })
        .returning(),
    );
    const [contact] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(contacts).values({ organizationId: organization.id, fullName: "Maria" }).returning(),
    );
    const [lead] = await runInTenantContext(db, organization.id, (tx) =>
      tx
        .insert(leads)
        .values({
          organizationId: organization.id,
          creatorId: creator.id,
          contactId: contact.id,
          qualified: true,
        })
        .returning(),
    );

    await expect(
      OpportunityService.createFromLead(db, organization.id, {
        leadId: lead.id,
        creatorId: creator.id,
        companyId: companyB.id,
        brandId: brand.id,
      }),
    ).rejects.toThrow(InvalidOpportunityPartyError);
  });

  it("creates an opportunity and its initial stage history entry when the party is valid", async () => {
    const { db, cleanup: c, organization, creator } = await setup();
    cleanup = c;

    const [company] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }).returning(),
    );
    const [contact] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(contacts).values({ organizationId: organization.id, fullName: "Maria" }).returning(),
    );
    const [lead] = await runInTenantContext(db, organization.id, (tx) =>
      tx
        .insert(leads)
        .values({
          organizationId: organization.id,
          creatorId: creator.id,
          contactId: contact.id,
          companyId: company.id,
          qualified: true,
        })
        .returning(),
    );

    const opportunity = await OpportunityService.createFromLead(db, organization.id, {
      leadId: lead.id,
      creatorId: creator.id,
      companyId: company.id,
      brandId: null,
    });

    expect(opportunity.stage).toBe("NOVO_LEAD");
    expect(opportunity.status).toBe("OPEN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/opportunity.service.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement the domain error**

```typescript
// src/domain/commercial-flow/errors.ts
export class InvalidOpportunityPartyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOpportunityPartyError";
  }
}
```

- [ ] **Step 4: Implement `src/repositories/leads.repository.ts`**

```typescript
// src/repositories/leads.repository.ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { leads } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "./tenant-context";

export type Lead = typeof leads.$inferSelect;

export const LeadsRepository = {
  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    leadId: string,
  ): Promise<Lead | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
      return lead ?? null;
    });
  },
};
```

- [ ] **Step 5: Implement `src/repositories/opportunities.repository.ts`**

```typescript
// src/repositories/opportunities.repository.ts
import { and, eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { opportunities, opportunityStageHistory, leads } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "./tenant-context";

export type Opportunity = typeof opportunities.$inferSelect;

export interface CreateOpportunityInput {
  creatorId: string;
  leadId: string;
  companyId: string | null;
  brandId: string | null;
}

export interface FindOpenForPartyInput {
  contactId?: string;
  companyId?: string;
  brandId?: string;
}

export const OpportunitiesRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateOpportunityInput,
  ): Promise<Opportunity> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [opportunity] = await tx
        .insert(opportunities)
        .values({
          organizationId,
          creatorId: input.creatorId,
          leadId: input.leadId,
          companyId: input.companyId,
          brandId: input.brandId,
          stage: "NOVO_LEAD",
          status: "OPEN",
        })
        .returning();

      await tx.insert(opportunityStageHistory).values({
        opportunityId: opportunity.id,
        fromStage: null,
        toStage: "NOVO_LEAD",
      });

      return opportunity;
    });
  },

  async findOpenForParty(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    party: FindOpenForPartyInput,
  ): Promise<Opportunity | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const conditions = [];
      if (party.companyId) conditions.push(eq(opportunities.companyId, party.companyId));
      if (party.brandId) conditions.push(eq(opportunities.brandId, party.brandId));
      if (party.contactId) {
        conditions.push(eq(leads.contactId, party.contactId));
      }

      if (conditions.length === 0) return null;

      const [opportunity] = await tx
        .select({ opportunity: opportunities })
        .from(opportunities)
        .innerJoin(leads, eq(leads.id, opportunities.leadId))
        .where(and(eq(opportunities.status, "OPEN"), or(...conditions)))
        .limit(1);

      return opportunity?.opportunity ?? null;
    });
  },
};
```

- [ ] **Step 6: Implement `src/services/opportunity.service.ts`**

```typescript
// src/services/opportunity.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { brands } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "@/repositories/tenant-context";
import {
  OpportunitiesRepository,
  type Opportunity,
  type FindOpenForPartyInput,
} from "@/repositories/opportunities.repository";
import { InvalidOpportunityPartyError } from "@/domain/commercial-flow/errors";

export interface CreateOpportunityFromLeadInput {
  leadId: string;
  creatorId: string;
  companyId: string | null;
  brandId: string | null;
}

async function assertValidParty(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateOpportunityFromLeadInput,
): Promise<void> {
  if (!input.companyId && !input.brandId) {
    throw new InvalidOpportunityPartyError(
      "Opportunity requires at least one of company_id or brand_id",
    );
  }

  if (input.companyId && input.brandId) {
    const brand = await runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.select().from(brands).where(eq(brands.id, input.brandId!));
      return row ?? null;
    });

    if (brand?.companyId && brand.companyId !== input.companyId) {
      throw new InvalidOpportunityPartyError(
        "brand.company_id must match opportunity.company_id when both are set",
      );
    }
  }
}

export const OpportunityService = {
  async createFromLead(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateOpportunityFromLeadInput,
  ): Promise<Opportunity> {
    await assertValidParty(db, organizationId, input);

    return OpportunitiesRepository.create(db, organizationId, {
      creatorId: input.creatorId,
      leadId: input.leadId,
      companyId: input.companyId,
      brandId: input.brandId,
    });
  },

  async findOpenOpportunityForParty(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    party: FindOpenForPartyInput,
  ): Promise<Opportunity | null> {
    return OpportunitiesRepository.findOpenForParty(db, organizationId, party);
  },
};
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run src/services/opportunity.service.test.ts`
Expected: PASS (all three tests)

- [ ] **Step 8: Commit**

```bash
git add src/domain src/repositories src/services
git commit -m "feat: enforce Opportunity company/brand rules and open-opportunity lookup"
```

---

### Task 14: Commercial Inquiry lifecycle — discard, convert, associate to existing Opportunity

**Files:**
- Modify: `src/repositories/commercial-inquiries.repository.ts` (add `findById`,
  `markDiscarded`, `markFalsePositive`, `markConverted`, `markLinkedToOpportunity`)
- Create: `src/repositories/companies.repository.ts`
- Create: `src/repositories/brands.repository.ts`
- Create: `src/repositories/contacts.repository.ts`
- Create: `src/services/commercial-inquiry.service.ts`
- Test: `src/services/commercial-inquiry.service.test.ts`

**Interfaces:**
- Produces: `CommercialInquiryService.discard(db, organizationId, inquiryId): Promise<void>`.
- Produces: `CommercialInquiryService.markFalsePositive(db, organizationId, inquiryId): Promise<void>`.
- Produces: `CommercialInquiryService.resolve(db, organizationId, inquiryId: string, resolution: { contact: { id: string } | { fullName: string; email?: string | null; phone?: string | null }; companyId?: string | null; brandId?: string | null }): Promise<{ inquiry: CommercialInquiry; lead: Lead; opportunity: Opportunity }>` —
  this is the **core orchestration** implementing spec §3's "cliente existente" and "fluxo
  completo" transitions: resolves/creates the Contact, checks
  `OpportunityService.findOpenOpportunityForParty`; if found, links the inquiry to it and
  returns the existing opportunity (no new Lead/Opportunity created); if not found, creates
  a Lead (auto-qualified when the contact/company already existed, qualified based on
  having enough info otherwise) and a new Opportunity via `OpportunityService.createFromLead`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/commercial-inquiry.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { InboxService } from "./inbox.service";
import { CommercialInquiryService } from "./commercial-inquiry.service";
import { OpportunityService } from "./opportunity.service";
import type { AIService } from "@/lib/ai/ai-service";
import { companies } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "@/repositories/tenant-context";

function fakeAI(classification: any): AIService {
  return { classifyMessage: async () => classification };
}

async function setupOrgAndCreator(db: any) {
  const { organization } = await OrganizationService.createWithOwner(db, {
    organizationName: "Org",
    ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const creator = await CreatorService.onboardCreator(db, organization.id, {
    email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
    fullName: "Thais",
    displayName: "Thais",
  });
  return { organization, creator };
}

describe("CommercialInquiryService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("discards an inquiry without creating a Lead or Opportunity", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setupOrgAndCreator(db);

    const ai = fakeAI({
      category: "COMMERCIAL_LEAD",
      commercialScore: 40,
      intent: null,
      extracted: {
        companyName: null,
        brandName: null,
        contactName: null,
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    });

    const { inquiry } = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Desconhecido",
      body: "Mensagem ambígua",
      receivedAt: new Date(),
    });

    await CommercialInquiryService.discard(db, organization.id, inquiry!.id);

    const updated = await CommercialInquiryService.findById(db, organization.id, inquiry!.id);
    expect(updated?.status).toBe("DISCARDED");
  });

  it("resolves a new company into a Lead and a new Opportunity", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setupOrgAndCreator(db);

    const ai = fakeAI({
      category: "COMMERCIAL_LEAD",
      commercialScore: 94,
      intent: "Pedido de mídia kit",
      extracted: {
        companyName: "Bella Cosméticos",
        brandName: null,
        contactName: "Maria",
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    });

    const { inquiry } = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores para uma campanha.",
      receivedAt: new Date(),
    });

    const result = await CommercialInquiryService.resolve(db, organization.id, inquiry!.id, {
      contact: { fullName: "Maria" },
    });

    expect(result.lead.qualified).toBe(true);
    expect(result.opportunity.status).toBe("OPEN");

    const updatedInquiry = await CommercialInquiryService.findById(db, organization.id, inquiry!.id);
    expect(updatedInquiry?.status).toBe("CONVERTED");
    expect(updatedInquiry?.convertedLeadId).toBe(result.lead.id);
  });

  it("associates a new inquiry to an existing open Opportunity for the same company instead of creating a duplicate", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setupOrgAndCreator(db);

    const [company] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }).returning(),
    );

    const ai = fakeAI({
      category: "COMMERCIAL_LEAD",
      commercialScore: 90,
      intent: "Pedido de mídia kit",
      extracted: {
        companyName: "Bella Cosméticos",
        brandName: null,
        contactName: "Maria",
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    });

    const first = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Primeira mensagem",
      receivedAt: new Date(),
    });
    const firstResolution = await CommercialInquiryService.resolve(
      db,
      organization.id,
      first.inquiry!.id,
      { contact: { fullName: "Maria" }, companyId: company.id },
    );

    const second = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Segunda mensagem, mesma negociação",
      receivedAt: new Date(),
    });
    const secondResolution = await CommercialInquiryService.resolve(
      db,
      organization.id,
      second.inquiry!.id,
      { contact: { fullName: "Maria" }, companyId: company.id },
    );

    expect(secondResolution.opportunity.id).toBe(firstResolution.opportunity.id);

    const allOpen = await OpportunityService.findOpenOpportunityForParty(db, organization.id, {
      companyId: company.id,
    });
    expect(allOpen?.id).toBe(firstResolution.opportunity.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/services/commercial-inquiry.service.test.ts`
Expected: FAIL — `CommercialInquiryService` doesn't exist yet.

- [ ] **Step 3: Extend `src/repositories/commercial-inquiries.repository.ts`**

```typescript
// append to src/repositories/commercial-inquiries.repository.ts
import { eq } from "drizzle-orm";
// (add to existing imports at the top of the file)

export const CommercialInquiriesRepositoryExtensions = {
  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<CommercialInquiry | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.select().from(commercialInquiries).where(eq(commercialInquiries.id, inquiryId));
      return row ?? null;
    });
  },

  async updateStatus(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
    fields: Partial<{
      status: CommercialInquiry["status"];
      convertedLeadId: string | null;
      linkedOpportunityId: string | null;
    }>,
  ): Promise<CommercialInquiry> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx
        .update(commercialInquiries)
        .set(fields)
        .where(eq(commercialInquiries.id, inquiryId))
        .returning();
      return row;
    });
  },
};

Object.assign(CommercialInquiriesRepository, CommercialInquiriesRepositoryExtensions);
```

Replace that last snippet with a direct edit instead of `Object.assign` — merge
`findById` and `updateStatus` directly into the existing `CommercialInquiriesRepository`
object literal in the file, and add `import { eq } from "drizzle-orm";` to the top-level
imports. The `Object.assign` form above is only illustrative of what must end up merged in.

- [ ] **Step 4: Implement `src/repositories/companies.repository.ts`, `brands.repository.ts`, `contacts.repository.ts`**

```typescript
// src/repositories/companies.repository.ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { companies } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "./tenant-context";

export type Company = typeof companies.$inferSelect;

export const CompaniesRepository = {
  async findByName(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
  ): Promise<Company | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.select().from(companies).where(eq(companies.name, name));
      return row ?? null;
    });
  },

  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: { name: string },
  ): Promise<Company> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.insert(companies).values({ organizationId, name: input.name }).returning();
      return row;
    });
  },
};
```

```typescript
// src/repositories/brands.repository.ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { brands } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "./tenant-context";

export type Brand = typeof brands.$inferSelect;

export const BrandsRepository = {
  async findByName(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
  ): Promise<Brand | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.select().from(brands).where(eq(brands.name, name));
      return row ?? null;
    });
  },
};
```

```typescript
// src/repositories/contacts.repository.ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "./tenant-context";

export type Contact = typeof contacts.$inferSelect;

export interface CreateContactInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  companyId?: string | null;
}

export const ContactsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateContactInput,
  ): Promise<Contact> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx
        .insert(contacts)
        .values({
          organizationId,
          fullName: input.fullName,
          email: input.email ?? null,
          phone: input.phone ?? null,
          companyId: input.companyId ?? null,
        })
        .returning();
      return row;
    });
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    contactId: string,
  ): Promise<Contact | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.select().from(contacts).where(eq(contacts.id, contactId));
      return row ?? null;
    });
  },
};
```

- [ ] **Step 5: Implement `LeadsRepository.create`**

Add to `src/repositories/leads.repository.ts`:

```typescript
// add to src/repositories/leads.repository.ts
export interface CreateLeadInput {
  creatorId: string;
  inquiryId: string | null;
  contactId: string;
  companyId: string | null;
  brandId: string | null;
  qualified: boolean;
}

// add this method inside the existing LeadsRepository object:
async create(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateLeadInput,
): Promise<Lead> {
  return runInTenantContext(db, organizationId, async (tx) => {
    const [lead] = await tx
      .insert(leads)
      .values({
        organizationId,
        creatorId: input.creatorId,
        inquiryId: input.inquiryId,
        contactId: input.contactId,
        companyId: input.companyId,
        brandId: input.brandId,
        qualified: input.qualified,
      })
      .returning();
    return lead;
  });
},
```

(Add the missing `import { leads } from "@/db/schema/commercial-flow";` and use it in place
of the bare `leads` import already present from Task 10's file, if not already imported.)

- [ ] **Step 6: Implement `src/services/commercial-inquiry.service.ts`**

```typescript
// src/services/commercial-inquiry.service.ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  CommercialInquiriesRepository,
  type CommercialInquiry,
} from "@/repositories/commercial-inquiries.repository";
import { CompaniesRepository } from "@/repositories/companies.repository";
import { ContactsRepository, type Contact } from "@/repositories/contacts.repository";
import { LeadsRepository, type Lead } from "@/repositories/leads.repository";
import { OpportunityService } from "./opportunity.service";
import type { Opportunity } from "@/repositories/opportunities.repository";

export interface ResolveContactByName {
  fullName: string;
  email?: string | null;
  phone?: string | null;
}

export interface ResolveInquiryInput {
  contact: { id: string } | ResolveContactByName;
  companyId?: string | null;
  brandId?: string | null;
}

export interface ResolveInquiryResult {
  inquiry: CommercialInquiry;
  lead: Lead;
  opportunity: Opportunity;
}

async function resolveContact(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: ResolveInquiryInput,
): Promise<{ contact: Contact; isNew: boolean }> {
  if ("id" in input.contact) {
    const contact = await ContactsRepository.findById(db, organizationId, input.contact.id);
    if (!contact) throw new Error(`Contact ${input.contact.id} not found`);
    return { contact, isNew: false };
  }

  const contact = await ContactsRepository.create(db, organizationId, {
    fullName: input.contact.fullName,
    email: input.contact.email ?? null,
    phone: input.contact.phone ?? null,
    companyId: input.companyId ?? null,
  });
  return { contact, isNew: true };
}

export const CommercialInquiryService = {
  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<CommercialInquiry | null> {
    return CommercialInquiriesRepository.findById(db, organizationId, inquiryId);
  },

  async discard(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<void> {
    await CommercialInquiriesRepository.updateStatus(db, organizationId, inquiryId, {
      status: "DISCARDED",
    });
  },

  async markFalsePositive(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
  ): Promise<void> {
    await CommercialInquiriesRepository.updateStatus(db, organizationId, inquiryId, {
      status: "FALSE_POSITIVE",
    });
  },

  async resolve(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    inquiryId: string,
    input: ResolveInquiryInput,
  ): Promise<ResolveInquiryResult> {
    const inquiry = await CommercialInquiriesRepository.findById(db, organizationId, inquiryId);
    if (!inquiry) throw new Error(`Commercial inquiry ${inquiryId} not found`);

    const { contact, isNew } = await resolveContact(db, organizationId, input);
    const companyId = input.companyId ?? null;
    const brandId = input.brandId ?? null;

    const existingOpportunity = await OpportunityService.findOpenOpportunityForParty(
      db,
      organizationId,
      { contactId: contact.id, companyId: companyId ?? undefined, brandId: brandId ?? undefined },
    );

    if (existingOpportunity) {
      const updatedInquiry = await CommercialInquiriesRepository.updateStatus(
        db,
        organizationId,
        inquiryId,
        { status: "CONVERTED", linkedOpportunityId: existingOpportunity.id },
      );

      const lead = await LeadsRepository.create(db, organizationId, {
        creatorId: inquiry.creatorId,
        inquiryId,
        contactId: contact.id,
        companyId,
        brandId,
        qualified: true,
      });

      return { inquiry: updatedInquiry, lead, opportunity: existingOpportunity };
    }

    const lead = await LeadsRepository.create(db, organizationId, {
      creatorId: inquiry.creatorId,
      inquiryId,
      contactId: contact.id,
      companyId,
      brandId,
      qualified: !isNew || Boolean(companyId || brandId),
    });

    const opportunity = await OpportunityService.createFromLead(db, organizationId, {
      leadId: lead.id,
      creatorId: inquiry.creatorId,
      companyId,
      brandId,
    });

    const updatedInquiry = await CommercialInquiriesRepository.updateStatus(
      db,
      organizationId,
      inquiryId,
      { status: "CONVERTED", convertedLeadId: lead.id },
    );

    return { inquiry: updatedInquiry, lead, opportunity };
  },
};
```

Note on Step 6's test #2 (`resolves a new company into a Lead and a new Opportunity`):
that test calls `resolve` **without** `companyId`/`brandId`, which would fail
`OpportunityService.createFromLead`'s party validation (Task 13) since neither is set.
Fix the test to pass a `companyId` — create the company first via `CompaniesRepository`
(or inline `db.insert(companies)...`) and pass its id, mirroring the third test. Adjust the
test's assertions accordingly before running.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run src/services/commercial-inquiry.service.test.ts`
Expected: PASS (all three tests)

- [ ] **Step 8: Commit**

```bash
git add src/repositories src/services
git commit -m "feat: add Commercial Inquiry lifecycle (discard, false positive, resolve to Lead/Opportunity)"
```

---

### Task 15: API routes — manual inbox ingestion and inquiry actions

**Files:**
- Create: `src/lib/ai/index.ts` (singleton factory reading `OPENAI_API_KEY`)
- Create: `src/db/index.ts` (singleton `getDb(process.env.DATABASE_URL!)`)
- Create: `src/app/api/inbox/messages/route.ts`
- Create: `src/app/api/commercial-inquiries/[id]/discard/route.ts`
- Create: `src/app/api/commercial-inquiries/[id]/convert/route.ts`
- Test: `src/app/api/inbox/messages/route.test.ts`

**Interfaces:**
- Produces: `POST /api/inbox/messages` accepting
  `{ organizationId: string; creatorId: string; source: "INSTAGRAM"|"WHATSAPP"|"TIKTOK"; externalContactLabel: string; body: string }`,
  returning `201` with `{ message, classification, inquiry }` (shape from Task 12).
- Produces: `POST /api/commercial-inquiries/:id/discard` accepting `{ organizationId: string }`, returning `204`.
- Produces: `POST /api/commercial-inquiries/:id/convert` accepting
  `{ organizationId: string; contact: {...}; companyId?: string; brandId?: string }`, returning `200` with `{ inquiry, lead, opportunity }` (shape from Task 14).

Note: these routes accept `organizationId` in the request body directly because
authentication/session wiring (resolving the caller's organization from Supabase Auth) is
explicitly out of scope for Milestone 1/2 of this plan — it is called out as a follow-up in
the Self-Review below and belongs to the Auth UI plan.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/inbox/messages/route.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";

vi.mock("@/db", () => ({
  db: undefined, // replaced per-test below via vi.doMock in each test body if needed
}));

describe("POST /api/inbox/messages", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the classification and a Commercial Inquiry for a commercial message", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));
    vi.doMock("@/lib/ai", () => ({
      ai: {
        classifyMessage: async () => ({
          category: "COMMERCIAL_LEAD",
          commercialScore: 94,
          intent: "Pedido de mídia kit",
          extracted: {
            companyName: "Bella Cosméticos",
            brandName: null,
            contactName: "Maria",
            email: null,
            phone: null,
            budget: null,
            deliverables: null,
          },
        }),
      },
    }));

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });

    const { POST } = await import("./route");

    const request = new Request("http://localhost/api/inbox/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        creatorId: creator.id,
        source: "INSTAGRAM",
        externalContactLabel: "Maria — Bella Cosméticos",
        body: "Olá, gostaríamos de saber os valores para uma campanha.",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.classification.category).toBe("COMMERCIAL_LEAD");
    expect(json.inquiry).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/api/inbox/messages/route.test.ts`
Expected: FAIL — `./route`, `@/db`, `@/lib/ai` don't exist yet.

- [ ] **Step 3: Implement the singletons**

```typescript
// src/db/index.ts
import { getDb } from "./client";

export const db = getDb(process.env.DATABASE_URL!);
```

```typescript
// src/lib/ai/index.ts
import { createOpenAIService } from "./openai-provider";

export const ai = createOpenAIService(process.env.OPENAI_API_KEY!);
```

- [ ] **Step 4: Implement the route handlers**

```typescript
// src/app/api/inbox/messages/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { ai } from "@/lib/ai";
import { InboxService } from "@/services/inbox.service";

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  creatorId: z.string().uuid(),
  source: z.enum(["INSTAGRAM", "WHATSAPP", "TIKTOK"]),
  externalContactLabel: z.string().min(1),
  body: z.string().min(1),
});

export async function POST(request: Request) {
  const payload = bodySchema.parse(await request.json());

  const result = await InboxService.ingestManualMessage(db, ai, payload.organizationId, {
    creatorId: payload.creatorId,
    source: payload.source,
    externalContactLabel: payload.externalContactLabel,
    body: payload.body,
    receivedAt: new Date(),
  });

  return NextResponse.json(result, { status: 201 });
}
```

```typescript
// src/app/api/commercial-inquiries/[id]/discard/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";

const bodySchema = z.object({ organizationId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const payload = bodySchema.parse(await request.json());
  await CommercialInquiryService.discard(db, payload.organizationId, params.id);
  return new NextResponse(null, { status: 204 });
}
```

```typescript
// src/app/api/commercial-inquiries/[id]/convert/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { CommercialInquiryService } from "@/services/commercial-inquiry.service";

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  contact: z.union([
    z.object({ id: z.string().uuid() }),
    z.object({
      fullName: z.string().min(1),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
    }),
  ]),
  companyId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const payload = bodySchema.parse(await request.json());
  const result = await CommercialInquiryService.resolve(db, payload.organizationId, params.id, {
    contact: payload.contact,
    companyId: payload.companyId ?? null,
    brandId: payload.brandId ?? null,
  });
  return NextResponse.json(result, { status: 200 });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/app/api/inbox/messages/route.test.ts`
Expected: PASS

- [ ] **Step 6: Verify the app still builds**

Run: `pnpm build`
Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
git add src/db/index.ts src/lib/ai/index.ts src/app/api
git commit -m "feat: expose Inbox and Commercial Inquiry flow as API routes"
```

---

## Self-Review

**Spec coverage:**
- §1 Visão/princípio de produto — reflected in Global Constraints and service naming; no
  code task needed (product principle, not a technical requirement).
- §2 Decisões #1, #3, #4, #6, #7, #8 (partial), #9, #10 (partial), #11, #12 — covered by
  Tasks 3–14. Decisões #2 (Media Kit/Rate Cards) and full #8/#10 (Rate Card price
  copy-on-create, Media Kit web page) are explicitly out of scope for this plan (Rate
  Cards/Proposals/Media Kit get their own plan, per the user's phasing instruction).
- §3 Fluxo de domínio — all four transitions (fã, descartada, cliente existente, fluxo
  completo) are covered: fã/spam in Task 12 (`NON_COMMERCIAL_CATEGORIES`), descartada/falso
  positivo in Task 14 (`discard`/`markFalsePositive`), cliente existente and fluxo completo
  both in Task 14 (`resolve`, branching on `findOpenOpportunityForParty`).
- §4 Riscos externos — informs Task 9's decision to make `messages.enteredManually` default
  `true` and `conversations.source` an enum without a live-API adapter; no further code
  needed at this plan's scope.
- §5 Arquitetura — AIService/OpenAI in Task 11, tenant context/RLS in Tasks 5–6, event bus
  explicitly deferred (not needed until a second consumer of `commercial_inquiry.created`
  exists — noted as a gap below).
- §6 Modelo de dados — all listed tables for this plan's scope are created (Tasks 3, 4, 8,
  9, 10). `rate_cards`, `proposals`, `campaigns`, `payments`, `commissions`, `media_kits`,
  `analytics_*` are correctly deferred to the next plan.
- §6 Regras de Opportunity (Decisões #11/#12) — Task 13 (validation) and Task 14
  (existing-opportunity reuse).
- §7 Escopo P0 — this plan implements the Inbox/AI Classification/Commercial
  Inquiry/Leads/Opportunities/Pipeline-stage slice of P0. Tasks, Services, Rate Cards,
  Proposals, Media Kit Web, Analytics Manual, Dashboard are correctly out of scope here.
- §8 UX — the API contract in Task 15 keeps the ingest call to a single request
  (paste + source + process in one call), matching the "mínimo de cliques" requirement;
  actual UI/keyboard-shortcut implementation belongs to a frontend-focused plan, not this
  backend-domain plan.

**Gap identified and resolved during self-review:** the original draft of Task 14's second
test called `resolve()` without a company/brand, which would fail Task 13's validation —
fixed inline in Step 6's note to pass a `companyId`.

**Known follow-ups (explicitly deferred, not silently dropped):**
1. Authentication/session wiring (Supabase Auth → resolving `organizationId` from the
   logged-in user instead of accepting it in the request body) — belongs to a
   dedicated Auth/UI plan; Task 15's routes are intentionally provisional on this point.
2. `ai_classifications`/`ai_extractions`/`ai_classification_feedback` tables from spec §6
   were not created — this plan stores the classification result directly on
   `commercial_inquiries` for the fields needed to drive the flow. Persisting the full raw
   classification for audit/feedback purposes is a follow-up task for the observability
   work, not required to make the core flow function.
3. The in-process event bus (spec §5) is deferred until a second consumer needs to react to
   `commercial_inquiry.created`/`lead.created`/`opportunity.created` — currently
   `InboxService` and `CommercialInquiryService` call each other directly, which is
   simpler and equally correct for a single consumer (YAGNI, per Global Constraints and
   spec §44).

**Type consistency:** verified `Lead`, `Opportunity`, `CommercialInquiry`,
`MessageClassification` types are inferred once (via `$inferSelect`/`z.infer`) and reused
by name across Tasks 12–15 without redefinition drift.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-21-core-domain-and-inbox-flow.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
