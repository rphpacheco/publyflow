CREATE UNIQUE INDEX "creators_org_user_unique" ON "creators" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "proposal_items_proposal_idx" ON "proposal_items" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "proposals_org_created_at_idx" ON "proposals" USING btree ("organization_id","created_at");