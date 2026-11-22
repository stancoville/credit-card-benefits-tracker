CREATE TABLE "unlock_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "unlock_attempts_attempted_at_idx" ON "unlock_attempts" USING btree ("attempted_at");--> statement-breakpoint
CREATE INDEX "unlock_attempts_ip_attempted_at_idx" ON "unlock_attempts" USING btree ("ip","attempted_at");