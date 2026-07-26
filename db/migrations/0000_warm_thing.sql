CREATE TYPE "public"."applies_to" AS ENUM('primary', 'authorized_user', 'both');--> statement-breakpoint
CREATE TYPE "public"."benefit_type" AS ENUM('credit', 'perk');--> statement-breakpoint
CREATE TYPE "public"."redemption_source" AS ENUM('manual', 'reminder');--> statement-breakpoint
CREATE TYPE "public"."reset_anchor" AS ENUM('calendar', 'card_open');--> statement-breakpoint
CREATE TYPE "public"."reset_type" AS ENUM('monthly', 'quarterly', 'semiannual', 'annual', 'rolling', 'one_time');--> statement-breakpoint
CREATE TABLE "benefit_exclusions" (
	"user_card_id" uuid NOT NULL,
	"benefit_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benefit_exclusions_user_card_id_benefit_id_pk" PRIMARY KEY("user_card_id","benefit_id")
);
--> statement-breakpoint
CREATE TABLE "benefits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"benefit_type" "benefit_type" NOT NULL,
	"max_value" integer,
	"reset_type" "reset_type" NOT NULL,
	"reset_interval" integer DEFAULT 1 NOT NULL,
	"reset_anchor" "reset_anchor" NOT NULL,
	"requires_enrollment" boolean DEFAULT false NOT NULL,
	"applies_to" "applies_to" NOT NULL,
	"merchant_scope" text,
	"notes" text,
	"source_url" text NOT NULL,
	"verified_on" date NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	CONSTRAINT "benefits_max_value_non_negative" CHECK ("benefits"."max_value" >= 0),
	CONSTRAINT "benefits_credit_requires_max_value" CHECK ("benefits"."benefit_type" <> 'credit' or "benefits"."max_value" is not null),
	CONSTRAINT "benefits_reset_interval_positive" CHECK ("benefits"."reset_interval" >= 1),
	CONSTRAINT "benefits_effective_window_ordered" CHECK ("benefits"."effective_to" is null or "benefits"."effective_to" >= "benefits"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "card_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"annual_fee" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	CONSTRAINT "card_products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "card_products_annual_fee_non_negative" CHECK ("card_products"."annual_fee" >= 0),
	CONSTRAINT "card_products_effective_window_ordered" CHECK ("card_products"."effective_to" is null or "card_products"."effective_to" >= "card_products"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"user_card_id" uuid NOT NULL,
	"benefit_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"enrolled_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_user_card_id_benefit_id_period_start_pk" PRIMARY KEY("user_card_id","benefit_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issuers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "issuers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_card_id" uuid NOT NULL,
	"benefit_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"amount" integer NOT NULL,
	"occurred_on" date NOT NULL,
	"note" text,
	"source" "redemption_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemptions_amount_non_negative" CHECK ("redemptions"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"nickname" text,
	"opened_on" date NOT NULL,
	"closed_on" date,
	"is_authorized_user" boolean DEFAULT false NOT NULL,
	"annual_fee_override" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_cards_closed_after_opened" CHECK ("user_cards"."closed_on" is null or "user_cards"."closed_on" >= "user_cards"."opened_on"),
	CONSTRAINT "user_cards_annual_fee_override_non_negative" CHECK ("user_cards"."annual_fee_override" is null or "user_cards"."annual_fee_override" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "benefit_exclusions" ADD CONSTRAINT "benefit_exclusions_user_card_id_user_cards_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_exclusions" ADD CONSTRAINT "benefit_exclusions_benefit_id_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."benefits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefits" ADD CONSTRAINT "benefits_product_id_card_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."card_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_products" ADD CONSTRAINT "card_products_issuer_id_issuers_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."issuers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_card_id_user_cards_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_benefit_id_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."benefits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_user_card_id_user_cards_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_benefit_id_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."benefits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_product_id_card_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."card_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "benefit_exclusions_benefit_idx" ON "benefit_exclusions" USING btree ("benefit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "benefits_product_slug_effective_from_key" ON "benefits" USING btree ("product_id","slug","effective_from");--> statement-breakpoint
CREATE INDEX "benefits_product_idx" ON "benefits" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "card_products_issuer_idx" ON "card_products" USING btree ("issuer_id");--> statement-breakpoint
CREATE INDEX "enrollments_benefit_idx" ON "enrollments" USING btree ("benefit_id");--> statement-breakpoint
CREATE INDEX "redemptions_card_benefit_period_idx" ON "redemptions" USING btree ("user_card_id","benefit_id","period_start");--> statement-breakpoint
CREATE INDEX "user_cards_household_idx" ON "user_cards" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "user_cards_product_idx" ON "user_cards" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "user_cards_owner_idx" ON "user_cards" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "users_household_idx" ON "users" USING btree ("household_id");