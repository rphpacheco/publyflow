CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit_description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;

-- Hand-appended (not drizzle-generated): RLS enabled in the same migration
-- that creates the table, per the Global Constraint carried over from the
-- previous plan's final-review finding (RLS deferred to a later task gets
-- silently skipped). Same convention as 0002_rls_core.sql: policy checks
-- app.current_org_id, set per-request by runInTenantContext.
alter table services enable row level security;

create policy org_isolation_services on services
  using (organization_id = current_setting('app.current_org_id', true)::uuid);