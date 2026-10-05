# Dashboard (agency commercial view)

Date: 2026-10-05. Status: approved design (user, 2026-10-05), pending written-spec review.
Origin: sidebar link `/dashboard` returns 404 (TAREFA 1b). Companies & Contacts shipped 2026-10-05.
Visual references chosen by the user: Dribbble "Real Estate CRM", "CRM Admin Dashboards with Shadcn/ui", "Insurance CRM PolicyPilot", "Health Dashboard"; Coupler.io "CRM dashboard for Pipedrive". Approved mockup: layout B (two columns), `.superpowers/brainstorm/…/content/dashboard-b-v2.html` (local only).

## 1. Decisions

| # | Decision |
|---|---|
| D1 | The dashboard answers three questions in one page: **Comercial** (funnel + money), **Requer ação** (what someone must resolve now) and **Creators** (performance per creator). Plus a small **Acompanhamento** block. |
| D2 | Access: **OWNER/MANAGER only**. CREATOR → 403 on the API; the page redirects a creator to `/pipeline`; the sidebar keeps hiding the link. The data layer still accepts `creatorScope` (always `null` from the routes today) — defensive, and ready if creators get access later. |
| D3 | Period: presets **Este mês** (default), **Mês passado**, **Últimos 90 dias**, **Este ano**, plus a free **de/até** range. `from`/`to` are inclusive calendar dates interpreted in **America/Sao_Paulo** (`from` = 00:00 local, `to` = 23:59:59.999 local). Max range 2 years. |
| D4 | Historical metrics respect the period; current-state metrics (pipeline now, funnel, open opportunities, action counts) ignore it. |
| D5 | Close/loss date = the **most recent** entry into `FECHADO` / `PERDIDO` in `opportunity_stage_history.changed_at`. An opportunity counts as **won in the period** when that most recent `FECHADO` entry is inside the period **and** its current `status = 'WON'`; **lost** likewise with `PERDIDO` and `status = 'LOST'`. Closed-then-reopened → not counted; closed, reopened, closed again → counted once. |
| D6 | Money (`opportunityValueCents`): **won** = Σ(quantity × unitPrice) of the snapshot of the version of the **most recent publication whose response action is `ACCEPT`** (among the opportunity's proposals); else `opportunities.estimated_value_cents`; else 0. **Open** = current items total of the most recent non-archived proposal of the opportunity; else estimated; else 0. Nothing financial is based on "proposals sent". |
| D7 | Inbox conversion = of the inquiries **created** in the period, how many have **current** status `CONVERTED` ("of the messages that arrived then, how many ended up converting"). |
| D8 | Average days to close = mean of (close date − `opportunities.created_at`) over opportunities won in the period, in days with one decimal; `null` ("—") when none. |
| D9 | Creator approval rate (UI label "Aprovação (cliente)") = `ACCEPT ÷ (ACCEPT + REJECT)` over client responses with `responded_at` in the period; `REQUEST_CHANGES` excluded; `null` ("—") when the denominator is 0. |
| D10 | Every historical card shows the change vs the **previous period of the same length immediately before** (October → September; a 10-day range → the 10 days before). Rates change in percentage points ("4 p.p."), counts/values in percent ("18%"), always with a lucide `ArrowUpRight` / `ArrowDownRight` / `Minus` icon (no ▲/▼ characters); previous = 0 → "—". Semantic color: up is good (green) except **Perdidas** and **Tempo até fechar** (up = red). |
| D11 | Chart "Fechado ao longo do período": won value (R$) per bucket — **day** when the period has ≤ 31 days, **week** (weeks starting Monday) when ≤ 180, **month** otherwise — buckets computed in America/Sao_Paulo, empty buckets zero-filled. New dependency **recharts** (v3, React 19 compatible — verify at install). |
| D12 | Two endpoints computed on request (no pre-aggregation): `GET /api/dashboard/metrics?from&to` (Comercial, chart, Creators) and `GET /api/dashboard/actions` (Requer ação + Acompanhamento). |
| D13 | Action counts reuse `ProposalQueueService.list` so numbers match the `/proposals` queue. |
| D14 | **Status fix (found while planning, user chose to fix the root cause):** moving an opportunity out of `FECHADO`/`PERDIDO` to an open stage never reset `status` (stayed `WON`/`LOST`), which would break D5 and every `status = 'OPEN'` count (incl. Companies' "Oportunidades abertas"). `updateStage` now sets `status = 'OPEN'` when the new stage is not terminal, and a **data-only migration** `0022` backfills `status = 'OPEN'` where `stage NOT IN ('FECHADO','PERDIDO') AND status <> 'OPEN'`. Deploy order: apply 0022 in production, then push. No schema change. |
| D16 | **No emoji or symbol characters in the UI** — icons only from **lucide-react** (the project's icon library). |
| D15 | Previous period (D10): when the period is a whole calendar month the previous period is the whole previous month; a whole calendar year → the previous year; otherwise the same number of days ending the day before `from`. |

## 2. Server

All queries/joins carry an explicit `organization_id` predicate inside `runInTenantContext`. Route: session (401) → `canManageOrganization` (CREATOR → 403) → zod (400). Errors `{ error, code? }`; validation `{ errors: z.flattenError(err).fieldErrors }`; Postgres 40P01 → 409 via `src/lib/db-errors.ts`; never raw exception text.

### 2.1 Pure modules
- `src/lib/dashboard/period.ts`
  - `resolvePreset(preset: "this_month" | "last_month" | "last_90_days" | "this_year", now: Date): { from: string; to: string }` (YYYY-MM-DD, America/Sao_Paulo).
  - `periodBounds({ from, to }): { start: Date; endExclusive: Date }` (UTC instants of local midnights).
  - `previousPeriod({ from, to }): { from; to }` (D15).
  - `bucketFor({ from, to }): "day" | "week" | "month"` and `bucketStarts({ from, to }, bucket): string[]` (local dates).
  - `periodQuerySchema` (zod): `from`, `to` required `YYYY-MM-DD`, valid dates; `to >= from` ("A data final deve ser igual ou posterior à inicial."); span ≤ 2 years ("O período máximo é de 2 anos."); missing → "Informe a data inicial." / "Informe a data final.".
- `src/lib/dashboard/value.ts` — `snapshotTotalCents(snapshotJson)` (via `parsePresentationSnapshot`, Σ quantity × unitPrice) and `resolveValueCents({ acceptedSnapshotTotal, currentProposalTotal, estimatedValueCents, won })` implementing D6.
- `src/lib/dashboard/delta.ts` — `computeDelta(current, previous, kind: "count" | "money" | "rate" | "days", higherIsBetter: boolean): { label: string | null; tone: "good" | "bad" | "neutral" }` implementing D10.

### 2.2 `GET /api/dashboard/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD`
Response:
```ts
{
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  current: PeriodMetrics;
  previous: PeriodMetrics;
  series: { bucket: "day" | "week" | "month"; points: Array<{ start: string; wonCents: number; wonCount: number }> };
  openNow: { count: number; valueCents: number };
  funnel: Array<{ stage: OpportunityStage; count: number }>; // open stages only, pipeline order, zeros included
  creators: Array<{ creatorId: string; name: string; openOpportunities: number; proposalsSent: number; wonCount: number; wonCents: number; approvalRate: number | null }>;
}
PeriodMetrics = {
  inquiriesReceived: number; inquiriesConverted: number; conversionRate: number | null;
  opportunitiesCreated: number;
  wonCount: number; wonCents: number; lostCount: number;
  winRate: number | null;            // won ÷ (won + lost)
  averageTicketCents: number | null; // wonCents ÷ wonCount
  averageDaysToClose: number | null;
}
```
- `creators`: every creator of the org (zero rows included), ordered by `wonCents` desc then name. `proposalsSent` = publications with `published_at` in the period (one per publication, re-sends included) for proposals of the creator's opportunities.
- `funnel`/`openNow`: opportunities with `status = 'OPEN'`, regardless of period; `FECHADO`/`PERDIDO` stages excluded from `funnel`.
- Layers: `DashboardRepository` (`src/repositories/dashboard.repository.ts`, SQL aggregates, each method takes `creatorScope`) → `DashboardService.getMetrics(db, orgId, period, { creatorScope })` (`src/services/dashboard.service.ts`, computes `current` and `previous` with the same code path, builds the zero-filled series and applies `value.ts`).

### 2.3 `GET /api/dashboard/actions`
Response:
```ts
{
  untriagedInquiries: number;         // commercial_inquiries status NEW
  clientChangesRequested: number;     // queue situation changes_requested with changes.by = "client"
  creatorChangesRequested: number;    // changes_requested with changes.by = "creator"
  awaitingCreatorApproval: number;    // awaiting_creator
  readyToSend: number;                // ready_to_send
  awaitingClient: number;             // awaiting_client (Acompanhamento)
  truncated: boolean;                 // the queue hit QUEUE_LIMIT (200)
}
```
`DashboardActionsService.get(db, orgId, { creatorScope })` (`src/services/dashboard-actions.service.ts`) calls `ProposalQueueService.list(db, orgId, { creatorScope, includeArchived: false })` and counts by situation, plus one inquiry count query.

## 3. UI — `/dashboard`

Pattern of the other app pages (client page, TanStack Query hooks in `src/hooks/use-dashboard.ts` on `apiFetch`, components in `src/components/dashboard/`). Creator → `router.replace("/pipeline")`. `/` keeps redirecting to `/pipeline`.

### 3.1 Header
"Dashboard" + preset segmented control (Este mês · Mês passado · 90 dias · Este ano) + "De/até" button with the lucide `CalendarRange` icon opening a popover with two date inputs and "Aplicar"; range errors shown inside the popover. The period lives in the URL (`?from&to`); no params → Este mês.

### 3.2 Left column (analysis)
1. **8 cards** (grid 4 cols desktop, 2 mobile): Fechado (R$, ctx "N oportunidades"), Taxa de fechamento (ctx "N ganhas · N perdidas"), Ticket médio, Tempo até fechar, Mensagens recebidas (ctx "N convertidas"), Conversão Inbox → Oportunidade, Oportunidades criadas, Perdidas. Each with its delta (D10).
2. **Chart** "Fechado ao longo do período" (`src/components/dashboard/won-chart.tsx`, recharts area/line; tooltip date + R$ + count).
3. **Pipeline agora**: "N abertas · R$ X em negociação" + one horizontal bar per open stage (pipeline order, `STAGE_LABELS`, count); clicking goes to `/pipeline`.
4. **Creators** table: Creator · Oport. abertas · Propostas enviadas · Fechadas (N · R$) · Aprovação (cliente) ("—" when null).

### 3.3 Right column (sticky on desktop, first on mobile)
- **Requer ação**: Mensagens sem triagem → `/inbox`; Ajustes pedidos pelo cliente, Ajustes pedidos pelo creator, Aguardando aprovação do creator, Prontas para enviar → `/proposals`. Colored count pills; zero rows dimmed (not removed); all zero → "Tudo em dia" with the lucide `CircleCheck` icon. `truncated` → counts shown as "200+".
- **Acompanhamento**: Aguardando resposta do cliente → `/proposals`.

### 3.4 Loading and errors
Each column loads independently: skeletons per card; on error "Não foi possível carregar · Tentar novamente" in that column only. Changing the period refetches only the metrics and keeps the previous numbers on screen until the new ones arrive (`placeholderData: keepPreviousData`).

## 4. Tests

Vitest against the real test Postgres (`withTestDb`, fixtures in `src/test/helpers`).
- **Pure**: `period.ts` (presets, month/year turn in America/Sao_Paulo incl. 2026-10-01 00:30 UTC → September, previous period, bucket choice, schema messages); `value.ts` (accepted snapshot → estimated → 0; v1 ACCEPT + v2 SENT still uses v1); `delta.ts` (p.p. vs %, base 0 → null, inverted tone for Perdidas/Tempo).
- **Repository/service**: won/lost rules of D5 (reopen cases); conversion of D7 (September message converted in October counts in September); D8 average; zero-filled series; funnel/openNow ignore the period; creators with zero activity; approval rate ignores REQUEST_CHANGES; **org isolation** (another org's data never enters any number); **`creatorScope`** restricts every number to that creator.
- **Actions**: counts equal a direct `ProposalQueueService.list` count for the same data; client vs creator changes split; `truncated` propagated.
- **Routes**: 401, 403 (CREATOR), 400 (each period message), 200 shape.
- **Hooks/components/page**: presets and de/até write the URL; right-column error does not hide the left; "Tudo em dia"; delta tone; creator redirect. The chart component is mocked in page tests (recharts does not render in jsdom); its own test only checks it receives points and labels.
- **Manual browser check** (user logs in): switch presets and a custom range, compare numbers with `/pipeline` and `/proposals`, mobile layout.

## 5. Out of scope
Creator access to the dashboard; pre-aggregated/cached metrics; comparison deltas on the chart, funnel or creators table; export; drill-down beyond the existing links; indexes (tracked in TAREFA tech debt).
