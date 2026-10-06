CREATE TABLE "company_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_aliases_org_name_unique" ON "company_aliases" USING btree ("organization_id",lower(trim("name")));
--> statement-breakpoint
alter table company_aliases enable row level security;
--> statement-breakpoint
create policy org_isolation_company_aliases on company_aliases
  using (organization_id = current_setting('app.current_org_id', true)::uuid);