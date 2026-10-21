CREATE TYPE "public"."transaction_source" AS ENUM('import', 'voice');--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "source" "transaction_source" DEFAULT 'import' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "capture_text" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "capture_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_id_capture_key_idx" ON "transactions" USING btree ("account_id","capture_key");