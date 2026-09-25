ALTER TYPE "public"."proposal_template" RENAME TO "proposal_theme";--> statement-breakpoint
ALTER TABLE "proposals" RENAME COLUMN "template" TO "theme";
