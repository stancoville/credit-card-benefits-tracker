-- Generated from db/schema.ts by `pnpm db:schema`. Do not edit by hand.
--
-- The full current schema in one file. Apply it to an empty database with:
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- An existing database should use `pnpm db:migrate` instead, which replays
-- db/migrations and records what it applied.

CREATE TYPE "public"."applies_to" AS ENUM('primary', 'authorized_user', 'both');
CREATE TYPE "public"."benefit_type" AS ENUM('credit', 'perk');
CREATE TYPE "public"."redemption_source" AS ENUM('manual', 'reminder');
CREATE TYPE "public"."reset_anchor" AS ENUM('calendar', 'card_open');
CREATE TYPE "public"."reset_type" AS ENUM('monthly', 'quarterly', 'semiannual', 'annual', 'rolling', 'one_time');
CREATE TYPE "public"."value_mode" AS ENUM('fixed', 'estimated');
CREATE TABLE "benefit_exclusions" (
	"user_card_id" uuid NOT NULL,
	"benefit_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benefit_exclusions_user_card_id_benefit_id_pk" PRIMARY KEY("user_card_id","benefit_id")
);

CREATE TABLE "benefits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"benefit_type" "benefit_type" NOT NULL,
	"max_value" integer,
	"value_mode" "value_mode" DEFAULT 'fixed' NOT NULL,
	"unlock_spend" integer,
	"repeatable" boolean DEFAULT false NOT NULL,
	"estimate_basis" text,
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
	CONSTRAINT "benefits_unlock_spend_non_negative" CHECK ("benefits"."unlock_spend" is null or "benefits"."unlock_spend" >= 0),
	CONSTRAINT "benefits_repeatable_must_be_credit" CHECK ("benefits"."repeatable" = false or "benefits"."benefit_type" = 'credit'),
	CONSTRAINT "benefits_unlock_spend_must_be_credit" CHECK ("benefits"."unlock_spend" is null or "benefits"."benefit_type" = 'credit'),
	CONSTRAINT "benefits_estimated_requires_basis" CHECK ("benefits"."value_mode" <> 'estimated' or "benefits"."estimate_basis" is not null),
	CONSTRAINT "benefits_estimated_must_be_credit" CHECK ("benefits"."value_mode" <> 'estimated' or "benefits"."benefit_type" = 'credit'),
	CONSTRAINT "benefits_effective_window_ordered" CHECK ("benefits"."effective_to" is null or "benefits"."effective_to" >= "benefits"."effective_from")
);

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

CREATE TABLE "enrollments" (
	"user_card_id" uuid NOT NULL,
	"benefit_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"enrolled_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_user_card_id_benefit_id_period_start_pk" PRIMARY KEY("user_card_id","benefit_id","period_start")
);

CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "issuers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"account_opened_hint" text,
	CONSTRAINT "issuers_slug_unique" UNIQUE("slug")
);

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

CREATE TABLE "unlock_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);

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

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "benefit_exclusions" ADD CONSTRAINT "benefit_exclusions_user_card_id_user_cards_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "benefit_exclusions" ADD CONSTRAINT "benefit_exclusions_benefit_id_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."benefits"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "benefits" ADD CONSTRAINT "benefits_product_id_card_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."card_products"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "card_products" ADD CONSTRAINT "card_products_issuer_id_issuers_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."issuers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_card_id_user_cards_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_benefit_id_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."benefits"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_user_card_id_user_cards_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_benefit_id_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."benefits"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_product_id_card_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."card_products"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "users" ADD CONSTRAINT "users_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "benefit_exclusions_benefit_idx" ON "benefit_exclusions" USING btree ("benefit_id");
CREATE UNIQUE INDEX "benefits_product_slug_effective_from_key" ON "benefits" USING btree ("product_id","slug","effective_from");
CREATE INDEX "benefits_product_idx" ON "benefits" USING btree ("product_id");
CREATE INDEX "card_products_issuer_idx" ON "card_products" USING btree ("issuer_id");
CREATE INDEX "enrollments_benefit_idx" ON "enrollments" USING btree ("benefit_id");
CREATE INDEX "redemptions_card_benefit_period_idx" ON "redemptions" USING btree ("user_card_id","benefit_id","period_start");
CREATE INDEX "unlock_attempts_attempted_at_idx" ON "unlock_attempts" USING btree ("attempted_at");
CREATE INDEX "unlock_attempts_ip_attempted_at_idx" ON "unlock_attempts" USING btree ("ip","attempted_at");
CREATE INDEX "user_cards_household_idx" ON "user_cards" USING btree ("household_id");
CREATE INDEX "user_cards_product_idx" ON "user_cards" USING btree ("product_id");
CREATE INDEX "user_cards_owner_idx" ON "user_cards" USING btree ("owner_user_id");
CREATE INDEX "users_household_idx" ON "users" USING btree ("household_id");
