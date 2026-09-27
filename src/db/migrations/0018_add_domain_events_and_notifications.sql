CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"processed_at" timestamp with time zone,
	CONSTRAINT "domain_events_type_format" CHECK ("domain_events"."event_type" ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
	CONSTRAINT "domain_events_status_check" CHECK ("domain_events"."status" in ('pending','processing','done','dead'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link_path" text,
	"source_event_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_event_recipient_unique" UNIQUE("source_event_id","recipient_user_id")
);
--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_source_event_id_domain_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."domain_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_events_pending_idx" ON "domain_events" USING btree ("next_attempt_at","occurred_at") WHERE "domain_events"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "domain_events_entity_idx" ON "domain_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id","created_at");

alter table domain_events enable row level security;

create policy org_isolation_domain_events on domain_events
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

alter table notifications enable row level security;

create policy org_isolation_notifications on notifications
  using (organization_id = current_setting('app.current_org_id', true)::uuid);