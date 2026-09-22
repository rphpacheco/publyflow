CREATE TYPE "public"."proposal_status" AS ENUM('DRAFT', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."proposal_template" AS ENUM('PREMIUM', 'MINIMAL', 'EDITORIAL', 'FASHION', 'BEAUTY', 'CORPORATE');--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"title" text NOT NULL,
	"template" "proposal_template" NOT NULL,
	"status" "proposal_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE restrict ON UPDATE no action;

-- Hand-appended (not drizzle-generated): RLS enabled in the same migration
-- that creates the table. Same convention as every prior RLS migration.
alter table proposals enable row level security;

create policy org_isolation_proposals on proposals
  using (organization_id = current_setting('app.current_org_id', true)::uuid);