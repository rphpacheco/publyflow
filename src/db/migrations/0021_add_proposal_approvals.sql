CREATE TYPE "public"."proposal_approval_decision" AS ENUM('APPROVED', 'CHANGES_REQUESTED');--> statement-breakpoint
CREATE TABLE "proposal_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"request_number" integer NOT NULL,
	"version_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" "proposal_approval_decision",
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"message" text,
	CONSTRAINT "proposal_approvals_proposal_number_unique" UNIQUE("proposal_id","request_number"),
	CONSTRAINT "proposal_approvals_decision_consistent" CHECK ((("proposal_approvals"."decision" is null) = ("proposal_approvals"."decided_by" is null)) and (("proposal_approvals"."decision" is null) = ("proposal_approvals"."decided_at" is null))),
	CONSTRAINT "proposal_approvals_changes_message" CHECK ("proposal_approvals"."decision" is distinct from 'CHANGES_REQUESTED' or ("proposal_approvals"."message" is not null and length(btrim("proposal_approvals"."message")) > 0))
);
--> statement-breakpoint
ALTER TABLE "proposal_publications" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "proposal_publications" ADD COLUMN "sent_without_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_version_id_proposal_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_approvals_proposal_idx" ON "proposal_approvals" USING btree ("proposal_id");--> statement-breakpoint
ALTER TABLE "proposal_publications" ADD CONSTRAINT "proposal_publications_approval_id_proposal_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."proposal_approvals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_publications" ADD CONSTRAINT "proposal_publications_approval_consistent" CHECK (not ("proposal_publications"."sent_without_approval" and "proposal_publications"."approval_id" is not null));
--> statement-breakpoint
alter table proposal_approvals enable row level security;
--> statement-breakpoint
create policy org_isolation_proposal_approvals on proposal_approvals
  using (organization_id = current_setting('app.current_org_id', true)::uuid);