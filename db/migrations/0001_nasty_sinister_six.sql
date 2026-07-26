CREATE TYPE "public"."redemption_source" AS ENUM('manual', 'reminder');--> statement-breakpoint
ALTER TABLE "redemptions" ADD COLUMN "source" "redemption_source" DEFAULT 'manual' NOT NULL;