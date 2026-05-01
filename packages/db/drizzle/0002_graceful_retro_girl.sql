CREATE TABLE "commission_recompute_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ruleset_hash" text,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"voided_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"error" text,
	"triggered_by" text
);
--> statement-breakpoint
CREATE TABLE "installment_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installment_id" uuid NOT NULL,
	"prev_status" "installment_status",
	"new_status" "installment_status" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text
);
--> statement-breakpoint
ALTER TABLE "commission_entries" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD COLUMN "canceled_reason" text;--> statement-breakpoint
ALTER TABLE "commission_recompute_runs" ADD CONSTRAINT "commission_recompute_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recompute_runs" ADD CONSTRAINT "commission_recompute_runs_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_status_history" ADD CONSTRAINT "installment_status_history_installment_id_payment_plan_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."payment_plan_installments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_status_history" ADD CONSTRAINT "installment_status_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_recompute_runs_sale_idx" ON "commission_recompute_runs" USING btree ("sale_id","run_at");--> statement-breakpoint
CREATE INDEX "commission_recompute_runs_workspace_idx" ON "commission_recompute_runs" USING btree ("workspace_id","run_at");--> statement-breakpoint
CREATE INDEX "installment_status_history_installment_idx" ON "installment_status_history" USING btree ("installment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "commission_entries_available_status_idx" ON "commission_entries" USING btree ("workspace_id","available_at") WHERE status = 'available';--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_upsert_key_uq" UNIQUE("sale_id","installment_id","recipient_user_id","sales_role_id","rule_id");