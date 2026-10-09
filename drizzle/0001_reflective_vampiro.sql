CREATE TYPE "public"."format_source" AS ENUM('heuristic', 'ai');--> statement-breakpoint
CREATE TABLE "bank_formats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"header_signature" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"source" "format_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_formats_header_signature_unique" UNIQUE("header_signature")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "account_key" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_account_key_unique" UNIQUE("account_key");