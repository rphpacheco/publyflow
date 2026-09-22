ALTER TABLE "opportunity_stage_history" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Hand-appended (not drizzle-generated): Fix 1 from the final whole-branch
-- review -- 0002_rls_core.sql only enabled RLS on organizations,
-- organization_members, and creators. The Milestone-2 tables below
-- (companies, brands, contacts, conversations, messages,
-- commercial_inquiries, leads, opportunities) had NO row-level security,
-- even though several repository methods query them by non-org-scoped
-- keys (e.g. CommercialInquiriesRepository.findById by just `id`) and rely
-- entirely on RLS for tenant isolation. opportunity_stage_history is
-- included here too, now that it has an organization_id column (added
-- above in this same migration) to policy against. Same convention as
-- 0002_rls_core.sql: policies check `app.current_org_id`, set per-request
-- by the repository layer via runInTenantContext.
alter table companies enable row level security;
alter table brands enable row level security;
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table commercial_inquiries enable row level security;
alter table leads enable row level security;
alter table opportunities enable row level security;
alter table opportunity_stage_history enable row level security;

create policy org_isolation_companies on companies
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_brands on brands
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_contacts on contacts
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_conversations on conversations
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_messages on messages
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_commercial_inquiries on commercial_inquiries
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_leads on leads
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_opportunities on opportunities
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_opportunity_stage_history on opportunity_stage_history
  using (organization_id = current_setting('app.current_org_id', true)::uuid);