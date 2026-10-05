# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

PublyFlow: a multi-tenant SaaS for creator agencies — inbox of commercial messages → leads/opportunities (pipeline) → proposals sent to brands via a public link, with the creator approving before sending. UI copy and user-facing error messages are in Portuguese (pt-BR).

Stack: Next.js 16 App Router (route handlers under `src/app/api`, `src/proxy.ts` instead of middleware), React 19 + TanStack Query, Drizzle ORM + Postgres, zod 4, Supabase Auth (`@supabase/ssr`), Vitest + Testing Library. Deployed on Vercel (Hobby → the domain-events cron in `vercel.json` runs once a day).

## Commands

Use pnpm from Homebrew (`/opt/homebrew/bin/pnpm`; Node ≥ 20).

- Dev server: `pnpm dev` (needs `.env.local`; see `.env.example`).
- Tests (all): `pnpm vitest run --testTimeout=60000 --hookTimeout=60000` (the defaults are too short for the DB-backed tests under load).
- Single file / test: `pnpm vitest run src/services/proposal.service.test.ts --testTimeout=60000 -t "name of the test"`.
- Typecheck: `pnpm tsc --noEmit` (in a fresh checkout/worktree run `pnpm exec next typegen` first, or `LayoutProps` is missing).
- Build: `OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test pnpm build` (the build evaluates modules that read these).
- Lint: `pnpm lint`.
- Generate a migration from schema changes: `pnpm drizzle-kit generate --name <name>` (writes `src/db/migrations/*`; hand-append RLS statements for new tenant tables — see 0017/0021).
- Apply migrations: `DATABASE_URL=postgresql://postgres:postgres@localhost:54329/<publyflow|publyflow_test> pnpm drizzle-kit migrate`. Production: `set -a; . ./.env.production.local; set +a; pnpm drizzle-kit migrate` — apply before pushing code that needs it (migrations are additive so old code keeps working).
- Create users/memberships: `pnpm provision-user` (uses the Supabase service-role key; OWNER/MANAGER only — CREATOR access is granted only through the in-app invite).

### Test database

Tests run against a real Postgres from `docker-compose.test.yml` (container `publyflow-postgres-1`, port 54329, data on a 2 GB **tmpfs**). The same container also hosts the local dev DB `publyflow`, so restarting/recreating it wipes dev data too. Start it from the repo root only (running `docker compose` from a worktree creates a second, stray project). Tests truncate tables after each test (`src/test/helpers/db.ts` — add new tables to `DOMAIN_TABLES` in FK order) and files run sequentially (`fileParallelism: false`). Never run two `vitest run` processes at the same time: they share the DB, collide (deadlocks/FK errors) and can transiently fill the tmpfs ("no space left on device"). `TEST_APP_DATABASE_URL` connects as `app_user` (no BYPASSRLS) for the `src/db/rls-*.test.ts` policy tests.

## Architecture

Layering: **route handler** (`src/app/api/**/route.ts`: session, auth, zod `safeParse`, error → HTTP mapping) → **service** (`src/services/*.service.ts`: business rules, transactions, domain events) → **repository** (`src/repositories/*.repository.ts`: Drizzle queries) → schema (`src/db/schema/*`). Domain error classes live in `src/domain/<area>/errors.ts`; pure rules live in `src/lib/**` (e.g. `src/lib/proposals/approval-state.ts`, `queue-situation.ts`) and are reused by services and UI. Client data access goes through hooks in `src/hooks/*` built on `apiFetch` (`src/lib/api-client.ts`, which always yields a readable `ApiError.message`; 5xx include the Vercel `x-vercel-id` reference).

### Multi-tenancy (critical)

The app connects to Postgres as a role that **bypasses RLS**. RLS policies exist (`org_isolation_*`, keyed on `app.current_org_id`, set by `runInTenantContext` in `src/repositories/tenant-context.ts`), but the real tenant boundary is that **every query and every join must carry an explicit `organization_id` predicate**. Services wrap work in `runInTenantContext(db, organizationId, async (tx) => …)`; repository methods have `…WithTx` variants that take that `tx`. Row locks (`lockByIdWithTx`, `FOR UPDATE`) are used where check-then-act races matter (proposal publish/approval, inquiry convert/edit, creator invite/e-mail transfer).

### Auth and roles

`getSession()` (`src/lib/auth/session.ts`) resolves the Supabase user to `Session { userId, organizationId, role: OWNER|MANAGER|CREATOR, creatorId }` (`resolve-session.ts` links a Supabase account to a `users` row by verified e-mail on first login; the oldest membership wins). Access helpers in `src/lib/auth/access.ts`:
- CREATOR is read-only by default: write routes must call `denyCreatorWrite(session)` or `canManageOrganization(role)`. `src/app/api/write-guard.test.ts` fails the build if a new POST/PATCH/PUT/DELETE route has neither (intentional exceptions are allow-listed there).
- CREATOR reads are scoped to their own creator (`creatorScope`, `proposalOutOfScope`): another creator's record → 404, org-management areas → 403.
- `[id]` routes validate with `isUuid` and return the route's own 404 for malformed ids (`src/app/api/id-guard.test.ts`).
- Public routes (`/p/[token]`, `/api/public/*`) are listed in `src/lib/auth/public-paths.ts` and are rate-limited in Postgres (`src/lib/rate-limit.ts`, `rate_limit_buckets`).

### Core domain flow

- **Inbox**: a manual message is classified by AI (`src/lib/ai`: Jev provider with OpenAI fallback, via `OPENAI_API_KEY`/`JEV_API_KEY`) into a `commercial_inquiry` with company/brand/contact guesses. NEW inquiries can be edited and then converted (`CommercialInquiryService.resolve`) into contact + lead + opportunity; an opportunity always needs a company or a brand.
- **Proposals**: every edit creates an immutable `proposal_versions` snapshot. Publishing (`ProposalSendingService.publish`) freezes a version into `proposal_publications` and exposes `/p/[token]`; the client's response (`proposal_responses`) moves the proposal status and the opportunity stage. When the opportunity's creator has a CREATOR membership, publishing requires the creator's approval of the latest version (`proposal_approvals`, state derived by `deriveApprovalState`), or an explicit "send without approval".
- **Presentation**: `buildPresentation` + `PresentationRenderer` render a version snapshot in one of six themes, shared by the builder preview and the public page.
- **Events/notifications**: services append `domain_events` (outbox) inside their transaction; `scheduleEventDrain()` (via `after()`) and the daily cron hit `/api/internal/events/drain` (Bearer `CRON_SECRET`), whose handlers (`src/services/event-handlers`) fan out per-member notifications (staff vs owning creator audiences).

### Route groups

`src/app/(app)` — authenticated app shell (inbox, pipeline, creators, proposals); `(auth)` — login (Google, password, magic link) and `/auth/callback`; `(preview)` — builder preview; `(public)` — public proposal page `/p/[token]`.

## Conventions

- Error responses: `{ error: "<mensagem em português>", code?: "MACHINE_CODE" }`; validation 400s: `{ errors: z.flattenError(err).fieldErrors }`. Never send raw exception text to the client; map domain errors explicitly (e.g. `src/app/api/commercial-inquiries/[id]/inquiry-errors.ts`) and map Postgres deadlocks (40P01) to 409 via `src/lib/db-errors.ts`.
- Tests that touch the DB use `withTestDb()` and fixtures in `src/test/helpers` (`seedProposal`, route helpers `importRouteWithSession` / `ownerSession` / `creatorSession`).
- Specs and implementation plans for each feature live in `docs/superpowers/specs` and `docs/superpowers/plans`; read the relevant spec before changing a feature's behavior.
