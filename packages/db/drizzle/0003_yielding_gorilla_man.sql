CREATE TABLE "webhook_inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "webhook_inbound_events_source_external_uq" UNIQUE("source","external_id")
);
--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD COLUMN "health_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD COLUMN "last_health_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_source_connections" ADD COLUMN "refresh_lock_acquired_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "webhook_inbound_events_received_at_idx" ON "webhook_inbound_events" USING btree ("received_at");