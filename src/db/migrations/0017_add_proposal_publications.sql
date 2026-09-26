CREATE TYPE "public"."proposal_response_action" AS ENUM('ACCEPT', 'REQUEST_CHANGES', 'REJECT');--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'SENT';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'CHANGES_REQUESTED';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'APPROVED';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'REJECTED';--> statement-breakpoint
CREATE TABLE "proposal_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"publication_number" integer NOT NULL,
	"version_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"context" jsonb NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_publications_proposal_number_unique" UNIQUE("proposal_id","publication_number")
);
--> statement-breakpoint
CREATE TABLE "proposal_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"action" "proposal_response_action" NOT NULL,
	"respondent_name" text NOT NULL,
	"respondent_email" text NOT NULL,
	"message" text,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_responses_publication_id_unique" UNIQUE("publication_id")
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "proposal_publications" ADD CONSTRAINT "proposal_publications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_publications" ADD CONSTRAINT "proposal_publications_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_publications" ADD CONSTRAINT "proposal_publications_version_id_proposal_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_publications" ADD CONSTRAINT "proposal_publications_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_responses" ADD CONSTRAINT "proposal_responses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_responses" ADD CONSTRAINT "proposal_responses_publication_id_proposal_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."proposal_publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_publications_proposal_idx" ON "proposal_publications" USING btree ("proposal_id");--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_public_token_unique" UNIQUE("public_token");

alter table proposal_publications enable row level security;

create policy org_isolation_proposal_publications on proposal_publications
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

alter table proposal_responses enable row level security;

create policy org_isolation_proposal_responses on proposal_responses
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Publications and responses are an audit trail: what the client received
-- and how they answered. They are never updated (deletion only by cascade).
create function prevent_update_immutable_row() returns trigger language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name;
end;
$$;

create trigger proposal_publications_immutable before update on proposal_publications
  for each row execute function prevent_update_immutable_row();

create trigger proposal_responses_immutable before update on proposal_responses
  for each row execute function prevent_update_immutable_row();