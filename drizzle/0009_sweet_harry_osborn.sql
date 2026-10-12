CREATE TYPE "public"."import_status" AS ENUM('running', 'done', 'failed');--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "status" "import_status" DEFAULT 'done' NOT NULL;