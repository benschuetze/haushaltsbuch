ALTER TYPE "public"."insight_kind" ADD VALUE 'subscription_found';--> statement-breakpoint
ALTER TYPE "public"."insight_kind" ADD VALUE 'cancellation_failed';--> statement-breakpoint
ALTER TYPE "public"."insight_kind" ADD VALUE 'cancellation_confirmed';--> statement-breakpoint
CREATE TABLE "subscription_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_key" text NOT NULL,
	"merchant" text NOT NULL,
	"cancelled_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_cancellations_merchant_key_unique" UNIQUE("merchant_key")
);
--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "subject" text;