CREATE TYPE "public"."proposal_block_type" AS ENUM('COVER', 'TEXT', 'IMAGE', 'METRICS', 'SERVICES', 'PRICING', 'TIMELINE', 'GALLERY', 'TESTIMONIALS', 'SOCIAL_LINKS', 'FOOTER');--> statement-breakpoint
CREATE TABLE "proposal_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"block_type" "proposal_block_type" NOT NULL,
	"content" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_blocks" ADD CONSTRAINT "proposal_blocks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_blocks" ADD CONSTRAINT "proposal_blocks_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;

alter table proposal_blocks enable row level security;

create policy org_isolation_proposal_blocks on proposal_blocks
  using (organization_id = current_setting('app.current_org_id', true)::uuid);