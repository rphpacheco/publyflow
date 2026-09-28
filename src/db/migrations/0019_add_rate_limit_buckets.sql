CREATE TABLE "rate_limit_buckets" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_buckets_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_window_idx" ON "rate_limit_buckets" USING btree ("window_start");
--> statement-breakpoint
-- No policies on purpose: deny-all for non-owner roles (anon/authenticated). The app connects as the
-- table owner, which bypasses RLS, exactly like the other tables (see 0002_rls_core.sql).
alter table rate_limit_buckets enable row level security;